import SwiftUI

struct StatusPillView: View {
    enum Status {
        case live, idle, error
    }

    let status: Status
    let text: String

    private var dotColor: Color {
        switch status {
        case .live: return .green
        case .idle: return .secondary
        case .error: return .red
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dotColor)
                .frame(width: 8, height: 8)
            Text(text)
                .font(.caption)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(.quaternary.opacity(0.5))
        .clipShape(Capsule())
    }
}
