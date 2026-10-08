import FeatureCore
import PennantAPI
import PennantDesign
import PennantKit
import SwiftUI

/// History: his record as a native table (the record chosen above it: batting, pitching, fielding, his last games, ...),
/// and beneath it, kept apart (D-020), where he is now as the export states it and what the transaction log says
/// happened, in its own words, each line with its date and source. A `TablePane`, as Mail lays out a list over a message.
struct PlayerHistoryTab: View {
    let dossier: Components.Schemas.PlayerDossierView
    @SceneStorage("player.history.record") private var record = ""

    private var tables: [Components.Schemas.PlayerTable] { dossier.history.tables }
    private var chosen: Components.Schemas.PlayerTable? { tables.first { $0.id == record } ?? tables.first }

    var body: some View {
        let h = dossier.history
        TablePane(detailShare: 0.45) {
            VStack(alignment: .leading, spacing: 8) {
                if tables.isEmpty {
                    if let empty = h.tablesEmpty { Text(verbatim: empty.display).foregroundStyle(.readableSecondary) }
                } else {
                    RecordChoice(tables: tables, chosen: chosen?.id ?? "", choose: { record = $0 })
                }
                if let note = chosen?.note {
                    Text(verbatim: note.display).font(.caption).foregroundStyle(.readableSecondary).help(detail: note.hint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } table: {
            if let chosen {
                PlayerRecordTable(table: chosen)
            } else {
                Color.readablePage
            }
        } detail: {
            VStack(alignment: .leading, spacing: 18) {
                PlayerSection("Where He Is Now", note: h.nowSource) { PlayerFacts(facts: h.now) }
                PlayerSection("What the Log Says") {
                    if let note = h.logNote { UnknownNote(cell: note) }
                    ForEach(h.log, id: \.id) { entry in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(verbatim: entry.date.display).font(.callout).monospacedDigit().foregroundStyle(.readableSecondary)
                                .frame(minWidth: 96, alignment: .leading)
                            ClaimText(entry.line, edge: .trailing) {
                                Text(verbatim: entry.line.text).font(.callout).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                if let contact = h.contact {
                    PlayerSection(nil) {
                        ClaimText(contact.title, edge: .trailing) { Text(verbatim: contact.title.text).font(.title3.weight(.semibold)) }
                        PlayerFacts(facts: contact.figures)
                        CellText(contact.line, secondary: true).font(.callout).fixedSize(horizontal: false, vertical: true)
                        if let reading = contact.reading { PlayerClaimLine(claim: reading, font: .callout) }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("player.tab.history")
    }
}

/// Which record the table shows: the served tables' titles, a segmented control for up to four and the shared pop-up
/// button past that (`PopUpChoice`, D-073).
struct RecordChoice: View {
    let tables: [Components.Schemas.PlayerTable]
    let chosen: String
    let choose: (String) -> Void

    var body: some View {
        if tables.count <= 4 {
            Picker(selection: Binding(get: { chosen }, set: choose)) {
                ForEach(tables, id: \.id) { t in Text(verbatim: t.title.display).tag(t.id) }
            } label: {
                Text("Record")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .accessibilityIdentifier("player.history.record")
        } else {
            PopUpChoice(
                title: "Record",
                choices: tables.map { .init($0.title.display, selected: $0.id == chosen) },
                id: "player.history.record"
            ) { choose(tables[$0].id) }
        }
    }
}

/// One of his records as a native `Table`: the served columns (hidden, moved and resized as the window remembers), sorted
/// by the served keys with the unknown last, keyboard navigation; it fills its pane and scrolls by itself.
struct PlayerRecordTable: View {
    let table: Components.Schemas.PlayerTable
    @State private var order: [ServedColumnSort<Components.Schemas.PlayerTableRow>] = []
    @State private var selection: String?
    @SceneStorage private var columns: TableColumnCustomization<Components.Schemas.PlayerTableRow>

    init(table: Components.Schemas.PlayerTable) {
        self.table = table
        _columns = SceneStorage(wrappedValue: TableColumnCustomization<Components.Schemas.PlayerTableRow>(), "player.table.\(table.id)")
    }

    private var rows: [Components.Schemas.PlayerTableRow] { ServedRows.sorted(table.rows, by: order) }

    var body: some View {
        Table(of: Components.Schemas.PlayerTableRow.self, selection: $selection, sortOrder: $order, columnCustomization: $columns) {
            TableColumnForEach(table.columns, id: \.id) { column in
                TableColumn(Text(verbatim: column.title.display), sortUsing: ServedColumnSort(column.id) { $0.key(column.id) }) { row in
                    if let cell = row.cells.additionalProperties[column.id] {
                        CellText(cell).monospacedDigit().lineLimit(1)
                    }
                }
                .width(min: column.numeric ? 40 : 56, ideal: column.numeric ? 52 : 90)
                .customizationID(column.id)
            }
        } rows: {
            ForEach(rows) { TableRow($0) }
        }
        .tableStyle(.inset(alternatesRowBackgrounds: false))
        .scrollContentBackground(.hidden)
        .background(Color.readablePage)
        .accessibilityLabel(Text(verbatim: table.title.display))
        .accessibilityIdentifier("table.player.\(table.id)")
        .overlay {
            if table.rows.isEmpty, let empty = table.empty {
                Text(verbatim: empty.display).foregroundStyle(.readableSecondary).padding(30)
            }
        }
    }
}
