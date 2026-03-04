import Foundation

actor KoinosRPCClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    // MARK: - JSON-RPC Types

    private struct RPCRequest: Encodable {
        let jsonrpc = "2.0"
        let id = 1
        let method: String
        let params: [String: AnyCodable]
    }

    private struct RPCResponse<T: Decodable>: Decodable {
        let jsonrpc: String?
        let id: Int?
        let result: T?
        let error: RPCError?
    }

    private struct RPCError: Decodable {
        let code: Int?
        let message: String?
    }

    // MARK: - Response Types

    struct HeadInfoResult: Decodable {
        let head_topology: HeadTopology?
        let head_block_time: String?

        struct HeadTopology: Decodable {
            let id: String?
            let height: String?
        }
    }

    struct BlocksByHeightResult: Decodable {
        let block_items: [BlockStoreItem]?
    }

    struct BlockStoreItem: Decodable {
        let block_id: String?
        let block_height: String?
        let block: Block?

        struct Block: Decodable {
            let id: String?
            let header: Header?

            struct Header: Decodable {
                let previous: String?
                let height: String?
                let timestamp: String?
                let signer: String?
            }
        }
    }

    // MARK: - Public API

    func getHeadInfo(rpcUrl: String) async throws -> HeadSnapshot {
        let result: HeadInfoResult = try await call(rpcUrl: rpcUrl, method: "chain.get_head_info", params: [:])

        guard let id = result.head_topology?.id, !id.isEmpty,
              let heightStr = result.head_topology?.height,
              let height = Int(heightStr), height > 0 else {
            throw RPCClientError.invalidResponse("Invalid chain.get_head_info response")
        }

        let timestampMs = Int64(result.head_block_time ?? "0") ?? 0
        return HeadSnapshot(id: id, height: height, timestampMs: timestampMs)
    }

    func getBlocksByHeight(rpcUrl: String, headBlockId: String, startHeight: Int, count: Int) async throws -> [BlockRow] {
        let params: [String: AnyCodable] = [
            "head_block_id": AnyCodable(headBlockId),
            "ancestor_start_height": AnyCodable(String(startHeight)),
            "num_blocks": AnyCodable(String(count)),
            "return_block": AnyCodable(true)
        ]

        let result: BlocksByHeightResult = try await call(rpcUrl: rpcUrl, method: "block_store.get_blocks_by_height", params: params)

        return (result.block_items ?? []).compactMap { item -> BlockRow? in
            let header = item.block?.header
            let height = Int(header?.height ?? item.block_height ?? "0") ?? 0
            let blockId = item.block?.id ?? item.block_id ?? ""
            guard height > 0, !blockId.isEmpty else { return nil }

            return BlockRow(
                height: height,
                blockId: blockId,
                previousId: header?.previous ?? "",
                signer: header?.signer ?? "",
                timestampMs: Int64(header?.timestamp ?? "0") ?? 0
            )
        }
    }

    func fetchLatestBlocks(rpcUrl: String, rowLimit: Int) async throws -> (head: HeadSnapshot, blocks: [BlockRow]) {
        let head = try await getHeadInfo(rpcUrl: rpcUrl)
        let startHeight = max(1, head.height - rowLimit + 1)
        let blocks = try await getBlocksByHeight(rpcUrl: rpcUrl, headBlockId: head.id, startHeight: startHeight, count: rowLimit)
        let sorted = blocks.sorted { $0.height > $1.height }
        return (head, sorted)
    }

    // MARK: - Private

    private func call<T: Decodable>(rpcUrl: String, method: String, params: [String: AnyCodable]) async throws -> T {
        guard let url = URL(string: rpcUrl) else {
            throw RPCClientError.invalidURL(rpcUrl)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15

        let body = RPCRequest(method: method, params: params)
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)

        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
            throw RPCClientError.httpError(httpResponse.statusCode)
        }

        let rpcResponse = try JSONDecoder().decode(RPCResponse<T>.self, from: data)

        if let error = rpcResponse.error {
            throw RPCClientError.rpcError(error.message ?? "RPC error")
        }

        guard let result = rpcResponse.result else {
            throw RPCClientError.emptyResult
        }

        return result
    }
}

enum RPCClientError: LocalizedError {
    case invalidURL(String)
    case httpError(Int)
    case rpcError(String)
    case emptyResult
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let url): return "Invalid RPC URL: \(url)"
        case .httpError(let code): return "RPC HTTP \(code)"
        case .rpcError(let msg): return msg
        case .emptyResult: return "Empty RPC result"
        case .invalidResponse(let msg): return msg
        }
    }
}

// Helper for encoding arbitrary JSON values
struct AnyCodable: Encodable {
    private let value: Any

    init(_ value: Any) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let v as String: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as Bool: try container.encode(v)
        default: try container.encode(String(describing: value))
        }
    }
}
