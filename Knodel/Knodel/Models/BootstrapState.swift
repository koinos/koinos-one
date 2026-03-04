import Foundation

enum BootstrapState: Equatable {
    case idle
    case downloading(progress: Double)
    case extracting
    case completed
    case failed(String)

    var isActive: Bool {
        switch self {
        case .downloading, .extracting: return true
        default: return false
        }
    }
}
