import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DialogButton, Field, PanelSectionRow } from "@decky/ui";
import { FaCaretDown, FaCaretUp } from "react-icons/fa";
import type {
  TradeSkillMasterLedger,
  TradeSkillMasterLedgerFigures,
  TradeSkillMasterLedgerFlow,
  TradeSkillMasterLedgerGold,
  TradeSkillMasterLedgerPeriod,
  TradeSkillMasterLedgerState,
} from "../../backend/src/api/contracts";
import { browseFocusView } from "../browseSessionState";
import { requestFocus } from "../focusMemory";
import { useTsmLedger } from "../tsmReads";
import { ledgerPlotWidth, pickLedgerFilter } from "../tsmLedgerFilters";
import { exportLedger, ledgerExport } from "../tsmLedgerExport";
import { descriptionStyle, STEAM } from "../steamTheme";
import { openLedgerItems } from "./TsmLedgerItemsModal";
import { FocusSlot, focusTarget } from "./FocusSlot";
import { Money } from "./Money";
import { SegmentRow, type BarSegment } from "./BrowseBar";
import { SegmentMenu } from "./SegmentMenu";
import {
  LEDGER_FULL_VALUE,
  LEDGER_HALF_VALUE,
  LEDGER_PERIOD_VALUE,
  LEDGER_PERIOD_WIDTH,
} from "./dropdownValue";
import { dayMonth, formatMoney, formatWhen } from "../text";

/** What an empty Ledger says, by the engine's reason. */
const EMPTY: Record<Exclude<TradeSkillMasterLedgerState, "ready">, [string, string]> = {
  noAddon: [
    "Install TradeSkillMaster to start recording",
    "The addon records your sales, purchases and gold while you play",
  ],
  noAccount: [
    "Nothing recorded yet",
    "Play a character with TradeSkillMaster enabled, then log out or /reload to save its records",
  ],
  noRecords: [
    "No sales, purchases or gold recorded yet",
    "TradeSkillMaster records them while you play and saves them when you log out or /reload",
  ],
};

/** The Ledger's rows in the destination's focus memory (S21, R1). */
const FOCUS_VIEW = browseFocusView("tsm");
export const LEDGER_FOCUS = {
  error: "ledger-error",
  empty: "ledger-empty",
  account: "ledger-account",
  realm: "ledger-realm",
  character: "ledger-character",
  period: "ledger-period",
  export: "ledger-export",
  gold: "ledger-gold",
  averages: "ledger-averages",
  sales: "ledger-sales",
  expenses: "ledger-expenses",
  profit: "ledger-profit",
  items: "ledger-items",
} as const;

/**
 * Bar segments that sit beside another on their row, by focus key: Left
 * from the key goes to its value (GetAddonsTab's pane Left handling;
 * Steam's own row navigation skipped the sibling and left the pane, DEVICE
 * 2026-10-23). Up and Down between the rows are Steam's own.
 */
export const LEDGER_LEFT_NEIGHBOUR: Record<string, string> = {
  [LEDGER_FOCUS.character]: LEDGER_FOCUS.realm,
  [LEDGER_FOCUS.period]: LEDGER_FOCUS.character,
};

/** The in-game Dashboard's periods, in its order. */
const PERIODS: TradeSkillMasterLedgerPeriod[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "All"];

/**
 * Export as a Steam settings row (S19): what it writes as the description,
 * the button on the right. Export writes the shown account's records for
 * the shown realm, or every realm, whatever Character and Period show, and
 * the description says so (owner, PR #318 review). Without records there
 * (gold logs are none) the button is disabled and takes no focus: Steam's
 * navigation stopped on a disabled button although A did nothing there
 * (DEVICE 2026-11-24).
 */
function ExportRow({
  installationId,
  ledger,
}: {
  installationId: string;
  ledger: TradeSkillMasterLedger;
}) {
  const { exporting } = useSyncExternalStore(ledgerExport.subscribe, ledgerExport.get);
  const canExport = ledger.exportable && ledger.account !== null;
  return (
    <PanelSectionRow>
      <div className="wowdeck-ledger-export">
        <Field
          label="Export ledger"
          description={
            canExport
              ? `${ledger.realm ?? "All realms"} · every character and period`
              : "Nothing to export yet"
          }
        >
          {canExport ? (
            <FocusSlot view={FOCUS_VIEW} id={LEDGER_FOCUS.export}>
              <DialogButton
                onClick={() =>
                  void exportLedger(installationId, ledger, () =>
                    requestFocus(FOCUS_VIEW, LEDGER_FOCUS.export),
                  )
                }
                onOKActionDescription="Export"
                style={{ minWidth: 0, width: "auto", padding: "10px 24px" }}
              >
                {exporting ? "Exporting…" : "Export"}
              </DialogButton>
            </FocusSlot>
          ) : (
            <DialogButton
              disabled
              focusable={false}
              onClick={() => {}}
              style={{ minWidth: 0, width: "auto", padding: "10px 24px" }}
            >
              Export
            </DialogButton>
          )}
        </Field>
      </div>
    </PanelSectionRow>
  );
}

/**
 * The Ledger's controls, at the top of its rows and scrolling with them
 * (owner, PR #318 review: only the title row floats): Account, only with
 * more than one account; Export; then Realm, Character and Period as the
 * browse bar's segments with in-pane menus (ADR 0002, G14), once the
 * account has records.
 */
function LedgerControls({
  installationId,
  ledger,
}: {
  installationId: string;
  ledger: TradeSkillMasterLedger;
}) {
  const pick = (change: Parameters<typeof pickLedgerFilter>[2]) =>
    pickLedgerFilter(installationId, ledger, change);
  const account: BarSegment = {
    id: "account",
    caption: "Account",
    focusId: LEDGER_FOCUS.account,
    menu: (
      <SegmentMenu
        menuLabel="Account"
        choices={ledger.accounts.map((name) => ({ data: name, label: name }))}
        selected={ledger.account}
        renderValue={LEDGER_FULL_VALUE}
        onPick={(name) => pick({ account: name })}
      />
    ),
  };
  const filters: BarSegment[] = [
    {
      id: "realm",
      caption: "Realm",
      focusId: LEDGER_FOCUS.realm,
      menu: (
        <SegmentMenu
          menuLabel="Realm"
          choices={[
            { data: null as string | null, label: "All realms" },
            ...ledger.realms.map((realm) => ({ data: realm as string | null, label: realm })),
          ]}
          selected={ledger.realm}
          renderValue={LEDGER_HALF_VALUE}
          onPick={(realm) => pick({ realm })}
        />
      ),
    },
    {
      id: "character",
      caption: "Character",
      focusId: LEDGER_FOCUS.character,
      menu: (
        <SegmentMenu
          menuLabel="Character"
          choices={[
            { data: null as string | null, label: "All characters" },
            ...ledger.characters.map((c) => ({ data: c.id as string | null, label: c.label })),
          ]}
          selected={ledger.character}
          renderValue={LEDGER_HALF_VALUE}
          onPick={(character) => pick({ character })}
        />
      ),
    },
    {
      id: "period",
      caption: "Period",
      focusId: LEDGER_FOCUS.period,
      flex: `0 0 ${LEDGER_PERIOD_WIDTH}px`,
      menu: (
        <SegmentMenu
          menuLabel="Period"
          choices={PERIODS.map((period) => ({ data: period, label: period }))}
          selected={ledger.period}
          renderValue={LEDGER_PERIOD_VALUE}
          onPick={(period) => pick({ period })}
        />
      ),
    },
  ];
  return (
    <>
      {ledger.accounts.length > 1 && <SegmentRow view={FOCUS_VIEW} segments={[account]} />}
      <ExportRow installationId={installationId} ledger={ledger} />
      {ledger.state === "ready" && <SegmentRow view={FOCUS_VIEW} segments={filters} />}
    </>
  );
}

/** A trend against the previous period: an arrow by shape and colour (S13). */
function Trend({ change, upIsGood }: { change: number | null; upIsGood: boolean }) {
  if (change === null || change === 0) {
    return null;
  }
  const up = change > 0;
  const Arrow = up ? FaCaretUp : FaCaretDown;
  return (
    <span
      className="wowdeck-ledger-trend"
      role="img"
      aria-label={up ? "Up from the previous period" : "Down from the previous period"}
      data-good={String(up === upIsGood)}
      style={{ color: up === upIsGood ? STEAM.positive : STEAM.danger }}
    >
      <Arrow />
    </span>
  );
}

/** A line of a panel: its label on the left, its value on the right. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wowdeck-ledger-line">
      <span>{label}</span>
      <span className="wowdeck-ledger-value">{children}</span>
    </div>
  );
}

/**
 * Sales, Expenses and Profit as one table (owner, PR #318 review): a row
 * each with its total, trend and per-day average, and its top item in grey
 * under it. One focus stop per row (G3), under a caption row naming the
 * columns.
 */
function FlowTable({ figures }: { figures: TradeSkillMasterLedgerFigures }) {
  const rows: [string, TradeSkillMasterLedgerFlow, boolean, string][] = [
    ["Sales", figures.earned, true, LEDGER_FOCUS.sales],
    ["Expenses", figures.spent, false, LEDGER_FOCUS.expenses],
    ["Profit", figures.profit, true, LEDGER_FOCUS.profit],
  ];
  return (
    <>
      <PanelSectionRow>
        <div className="wowdeck-ledger-flows wowdeck-ledger-caption">
          <span />
          <span>Total</span>
          <span>Per day</span>
        </div>
      </PanelSectionRow>
      {rows.map(([heading, flow, upIsGood, focusKey]) => (
        <PanelSectionRow key={heading}>
          <Field
            focusable
            childrenLayout="below"
            childrenContainerWidth="max"
            {...focusTarget(FOCUS_VIEW, focusKey)}
          >
            <div className="wowdeck-ledger-flows">
              <span className="wowdeck-ledger-flow-name">{heading}</span>
              <span className="wowdeck-ledger-value">
                <Trend change={flow.trend} upIsGood={upIsGood} />
                <Money copper={flow.total} />
              </span>
              <span className="wowdeck-ledger-value">
                <Money copper={flow.perDay} />
              </span>
            </div>
            <div className="wowdeck-ledger-note">
              Top item · {flow.topItemName ?? flow.topItem ?? "None"}
            </div>
          </Field>
        </PanelSectionRow>
      ))}
    </>
  );
}

/** The graph's drawing box; the SVG stretches it to the row's width. */
const GRAPH_WIDTH = 300;
const GRAPH_HEIGHT = 72;

/**
 * The selection's gold over the period, as the in-game Dashboard's graph:
 * one line through the engine's samples (Retail's 1,000 g steps as
 * recorded, which a note under the line names on Retail), then the 52-week
 * High and Low and the daily change. One focus
 * stop (G3), so the D-pad scrolls past it.
 */
function GoldGraph({
  gold,
  now,
  retail,
}: {
  gold: TradeSkillMasterLedgerGold | null;
  now: number;
  retail: boolean;
}) {
  // The engine samples the line for the plot's laid-out width, as the addon
  // samples its own graph (a step per 3 px).
  const plot = useRef<SVGSVGElement>(null);
  // useId's colons are not valid in url(#…) references.
  const fillId = `wowdeck-gold-fill${useId().replace(/:/g, "")}`;
  useLayoutEffect(() => {
    if (plot.current) ledgerPlotWidth.set(plot.current.getBoundingClientRect().width);
  });
  if (!gold) {
    return (
      <PanelSectionRow>
        <Field focusable label="No gold history" {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.gold)} />
      </PanelSectionRow>
    );
  }
  const values = gold.points.map(([, copper]) => copper);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const first = gold.points[0]![0];
  const span = gold.points[gold.points.length - 1]![0] - first;
  // A flat line sits in the middle; the line's width stays inside the box.
  const y = (copper: number) =>
    high === low ? GRAPH_HEIGHT / 2 : 1 + ((high - copper) / (high - low)) * (GRAPH_HEIGHT - 2);
  const x = (ms: number) => (span === 0 ? 0 : ((ms - first) / span) * GRAPH_WIDTH);
  // One point (a first balance logged this minute) is a flat line across.
  const line =
    gold.points.length === 1
      ? `0,${y(values[0]!)} ${GRAPH_WIDTH},${y(values[0]!)}`
      : gold.points.map(([ms, copper]) => `${x(ms)},${y(copper)}`).join(" ");
  // The area under the line, closed along the bottom of the box.
  const area = `${line} ${GRAPH_WIDTH},${GRAPH_HEIGHT} 0,${GRAPH_HEIGHT}`;
  const start = dayMonth(new Date(first), new Date(now));
  return (
    <PanelSectionRow>
      <Field
        focusable
        label="Gold"
        childrenLayout="below"
        {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.gold)}
      >
        <div className="wowdeck-ledger-gold">
          <svg
            ref={plot}
            role="img"
            aria-label={`Gold from ${start} to now, between ${formatMoney(low)} and ${formatMoney(high)}`}
            viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
            preserveAspectRatio="none"
          >
            {/* A soft fill under the line in Steam's blue, fading out
                towards the bottom (owner, PR #318 review). */}
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={STEAM.primary} stopOpacity={0.35} />
                <stop offset="1" stopColor={STEAM.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <polygon points={area} fill={`url(#${fillId})`} stroke="none" />
            <polyline
              points={line}
              fill="none"
              stroke={STEAM.primary}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <Line label={start}>Now</Line>
          {retail && (
            <div className="wowdeck-ledger-note">Retail records your gold in steps of 1,000g</div>
          )}
          <Line label="52-week high">
            <Money copper={gold.high} />
          </Line>
          <Line label="52-week low">
            <Money copper={gold.low} />
          </Line>
          <Line label="Daily change">
            <Money copper={gold.dailyChange} />
          </Line>
        </div>
      </Field>
    </PanelSectionRow>
  );
}

/** Items per day, as the Dashboard rounds them: one decimal. */
const perDay = (items: number) => String(Math.round(items * 10) / 10);

/**
 * The figures under the graph: the four that are not the graph's in a 2×2
 * grid, then the Sales, Expenses and Profit table.
 */
function Figures({ figures }: { figures: TradeSkillMasterLedgerFigures }) {
  const cells: [string, ReactNode][] = [
    ["Avg daily sales", perDay(figures.dailySales)],
    ["Avg daily purchases", perDay(figures.dailyPurchases)],
    ["Top sale", <Money copper={figures.topSale} />],
    ["Top purchase", <Money copper={figures.topPurchase} />],
  ];
  return (
    <>
      <PanelSectionRow>
        <Field focusable childrenLayout="below" {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.averages)}>
          <div className="wowdeck-ledger-grid">
            {cells.map(([label, value]) => (
              <div key={label}>
                <div className="wowdeck-ledger-caption">{label}</div>
                <div className="wowdeck-ledger-value">{value}</div>
              </div>
            ))}
          </div>
        </Field>
      </PanelSectionRow>
      <FlowTable figures={figures} />
    </>
  );
}

function AllItemsRow({
  installationId,
  ledger,
}: {
  installationId: string;
  ledger: TradeSkillMasterLedger;
}) {
  return (
    <PanelSectionRow>
      <Field
        focusable
        label={`All items (${ledger.itemCount})`}
        onOKActionDescription="View items"
        onClick={() => openLedgerItems(installationId, ledger, LEDGER_FOCUS.items)}
        {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.items)}
      />
    </PanelSectionRow>
  );
}

/**
 * The Ledger (GLOSSARY): what the TradeSkillMaster addon recorded for the
 * active installation, read from the game's saved settings. It needs no
 * TradeSkillMaster sign-in and only reads.
 */
export function TsmLedger({ installationId }: { installationId: string }) {
  const { data, error, loading } = useTsmLedger(installationId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {loading && !data && (
        <PanelSectionRow>
          <Field label="Reading TradeSkillMaster's records…" />
        </PanelSectionRow>
      )}
      {error && (
        <PanelSectionRow>
          <Field focusable label={error} {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.error)} />
        </PanelSectionRow>
      )}
      {data && !error && (
        <>
          <LedgerControls installationId={installationId} ledger={data} />
          {/* Without the addon nothing records, so nothing is dated. Plain
              text with no focus stop (owner, PR #318 review): the controls
              above it already bring the top of the view into sight. */}
          {data.recordedAt !== null && data.state !== "noAddon" && (
            <PanelSectionRow>
              <div className="wowdeck-ledger-recorded" style={descriptionStyle}>
                <div>Recorded at last logout · {formatWhen(data.recordedAt, now)}</div>
                {data.gameRunning && <div>Log out or /reload to include this session</div>}
              </div>
            </PanelSectionRow>
          )}
          {data.state === "ready" && data.figures && (
            <>
              <GoldGraph gold={data.gold} now={now} retail={data.retail} />
              <Figures figures={data.figures} />
              <AllItemsRow installationId={installationId} ledger={data} />
            </>
          )}
          {data.state !== "ready" && (
            <PanelSectionRow>
              <Field
                focusable
                label={EMPTY[data.state][0]}
                description={EMPTY[data.state][1]}
                {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.empty)}
              />
            </PanelSectionRow>
          )}
        </>
      )}
    </>
  );
}
