import Foundation

struct HeadSnapshot {
    let id: String
    let height: Int
    let timestampMs: Int64

    var date: Date {
        Date(timeIntervalSince1970: Double(timestampMs) / 1000.0)
    }
}
