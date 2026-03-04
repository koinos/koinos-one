import SwiftUI

struct DataSourcePicker: View {
    @Binding var selection: BlockExplorerViewModel.DataSource

    var body: some View {
        Picker("Data Source", selection: $selection) {
            ForEach(BlockExplorerViewModel.DataSource.allCases) { source in
                Text(source.rawValue).tag(source)
            }
        }
        .pickerStyle(.segmented)
        .frame(width: 200)
    }
}
