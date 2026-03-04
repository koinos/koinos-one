import Foundation

struct ServiceState: Identifiable, Hashable {
    let name: String
    let service: String
    let state: String
    let status: String

    var id: String { "\(service)-\(name)" }

    var isRunning: Bool {
        let combined = "\(state) \(status)"
        return combined.range(of: "running|up", options: [.regularExpression, .caseInsensitive]) != nil
    }
}
