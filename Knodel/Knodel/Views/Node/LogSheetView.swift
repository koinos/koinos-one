import SwiftUI

struct LogSheetView: View {
    let service: String
    let nodeVM: NodeManagerViewModel

    @StateObject private var vm = LogStreamViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            logContent
        }
        .task {
            await startStream()
        }
        .onDisappear {
            vm.stop()
        }
    }

    private func startStream() async {
        let stream = await nodeVM.logsStream()
        vm.start(provider: { stream })
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Service Logs")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(service)
                    .font(.headline)
                    .fontDesign(.monospaced)
                Text(vm.isConnected ? "Streaming (docker compose logs -f)" : "Disconnected")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            HStack(spacing: 8) {
                Circle()
                    .fill(vm.isConnected ? Color.green : Color.secondary)
                    .frame(width: 8, height: 8)

                Button("Reconnect") {
                    Task { await startStream() }
                }
                .disabled(vm.isConnected)

                Button("Close") {
                    dismiss()
                }
            }
        }
        .padding(12)
    }

    private var logContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if vm.logText.characters.isEmpty {
                        Text(vm.isConnected ? "Waiting for logs..." : "No logs available")
                            .foregroundStyle(.secondary)
                            .padding()
                    } else {
                        Text(vm.logText)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(8)
                    }

                    Color.clear.frame(height: 1).id("bottom")
                }
            }
            .background(Color(nsColor: .textBackgroundColor))
            .onChange(of: vm.logText) {
                withAnimation {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
    }
}
