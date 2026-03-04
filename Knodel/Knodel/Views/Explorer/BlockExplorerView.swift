import SwiftUI

struct BlockExplorerView: View {
    @EnvironmentObject var vm: BlockExplorerViewModel
    @State private var now = Date()

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 0) {
            statsBar
            Divider()
            blockTable
        }
        .onReceive(timer) { now = $0 }
    }

    private var statsBar: some View {
        HStack(spacing: 12) {
            DataSourcePicker(selection: $vm.dataSource)
                .onChange(of: vm.dataSource) {
                    vm.startPolling()
                }

            Spacer()

            statCard(label: "RPC", value: vm.effectiveRpcUrl)
            statCard(label: "Head", value: vm.head.map { "#\($0.height.formatted())" } ?? "...")
            statCard(label: "Head Time", value: vm.head.map { $0.date.formatted(date: .abbreviated, time: .standard) } ?? "N/A")
            statCard(label: "Last Sync", value: vm.lastSuccessAt?.formatted(date: .omitted, time: .standard) ?? "N/A")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func statCard(label: String, value: String) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.caption)
                    .fontDesign(.monospaced)
                    .lineLimit(1)
            }
        }
    }

    private var blockTable: some View {
        Group {
            if vm.isInitialLoading && vm.blocks.isEmpty {
                VStack {
                    Spacer()
                    ProgressView("Connecting to RPC...")
                    Spacer()
                }
            } else if vm.blocks.isEmpty {
                VStack {
                    Spacer()
                    Text("No blocks received from the configured RPC.")
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            } else {
                Table(vm.blocks) {
                    TableColumn("Height") { row in
                        Text("#\(row.height.formatted())")
                            .fontDesign(.monospaced)
                    }
                    .width(min: 80, ideal: 100)

                    TableColumn("Block ID") { row in
                        Text(row.shortBlockId)
                            .fontDesign(.monospaced)
                            .help(row.blockId)
                    }
                    .width(min: 200, ideal: 280)

                    TableColumn("Producer") { row in
                        Text(row.shortSigner)
                            .fontDesign(.monospaced)
                            .help(row.signer)
                    }
                    .width(min: 160, ideal: 220)

                    TableColumn("Age") { row in
                        Text(row.relativeAge(from: now))
                    }
                    .width(min: 50, ideal: 60)

                    TableColumn("Timestamp") { row in
                        Text(row.timestampMs > 0 ? row.date.formatted(date: .abbreviated, time: .standard) : "N/A")
                    }
                    .width(min: 140, ideal: 180)
                }
            }
        }
        .overlay(alignment: .top) {
            if let error = vm.errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.yellow)
                    Text("RPC Error: \(error)")
                        .font(.callout)
                    Spacer()
                }
                .padding(8)
                .background(.red.opacity(0.1))
                .cornerRadius(6)
                .padding(.horizontal, 8)
                .padding(.top, 4)
            }
        }
    }
}
