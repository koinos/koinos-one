import Foundation

enum KoinosService: String, CaseIterable, Identifiable {
    case amqp
    case chain
    case mempool
    case blockStore = "block_store"
    case p2p
    case blockProducer = "block_producer"
    case jsonrpc
    case grpc
    case transactionStore = "transaction_store"
    case contractMetaStore = "contract_meta_store"
    case accountHistory = "account_history"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .amqp: return "AMQP"
        case .chain: return "Chain"
        case .mempool: return "Mempool"
        case .blockStore: return "Block Store"
        case .p2p: return "P2P"
        case .blockProducer: return "Block Producer"
        case .jsonrpc: return "JSON-RPC"
        case .grpc: return "gRPC"
        case .transactionStore: return "Tx Store"
        case .contractMetaStore: return "Contract Meta"
        case .accountHistory: return "Account History"
        }
    }

    var sfSymbol: String {
        switch self {
        case .amqp: return "message.fill"
        case .chain: return "link"
        case .mempool: return "tray.full.fill"
        case .blockStore: return "externaldrive.fill"
        case .p2p: return "network"
        case .blockProducer: return "hammer.fill"
        case .jsonrpc: return "curlybraces"
        case .grpc: return "arrow.left.arrow.right"
        case .transactionStore: return "doc.on.doc.fill"
        case .contractMetaStore: return "doc.text.fill"
        case .accountHistory: return "clock.fill"
        }
    }
}
