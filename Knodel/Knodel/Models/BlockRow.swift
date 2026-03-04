import Foundation

struct BlockRow: Identifiable, Hashable {
    var id: String { blockId }

    let height: Int
    let blockId: String
    let previousId: String
    let signer: String
    let timestampMs: Int64

    var date: Date {
        Date(timeIntervalSince1970: Double(timestampMs) / 1000.0)
    }

    var shortBlockId: String {
        shortHash(blockId, head: 18, tail: 12)
    }

    var shortSigner: String {
        shortHash(signer, head: 14, tail: 10)
    }

    func relativeAge(from now: Date = Date()) -> String {
        guard timestampMs > 0 else { return "N/A" }
        let diffSec = max(0, Int(now.timeIntervalSince1970 - Double(timestampMs) / 1000.0))
        if diffSec < 60 { return "\(diffSec)s" }
        let diffMin = diffSec / 60
        if diffMin < 60 { return "\(diffMin)m" }
        let diffHours = diffMin / 60
        if diffHours < 24 { return "\(diffHours)h" }
        let diffDays = diffHours / 24
        return "\(diffDays)d"
    }
}

private func shortHash(_ value: String, head: Int, tail: Int) -> String {
    guard !value.isEmpty else { return "N/A" }
    if value.count <= head + tail + 1 { return value }
    let prefix = value.prefix(head)
    let suffix = value.suffix(tail)
    return "\(prefix)...\(suffix)"
}
