import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
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
import {
  AXIS_LABEL_HEIGHT,
  goldXAxis,
  goldYAxis,
  type GoldXTick,
  type GoldYAxis,
} from "../tsmGoldAxes";
import { FocusSlot, focusTarget } from "./FocusSlot";
import { Money } from "./Money";
import { dashboardMoney, dashboardSummaryMoney } from "../tsmLedgerMoney";
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
 * each with its total and per-day average, each behind the period's trend
 * as the in-game Dashboard shows it on both lines, and its top item in grey
 * under it. One focus stop per row (G3), under a caption row naming the
 * columns. Amounts round as the Dashboard's details rows do.
 */
function FlowTable({
  figures,
  retail,
}: {
  figures: TradeSkillMasterLedgerFigures;
  retail: boolean;
}) {
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
                <Money copper={dashboardMoney(flow.total, retail)} />
              </span>
              <span className="wowdeck-ledger-value">
                <Trend change={flow.trend} upIsGood={upIsGood} />
                <Money copper={dashboardMoney(flow.perDay, retail)} />
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

/**
 * The plot's height in CSS px, and its width until the graph is laid out.
 * The in-game graph keeps a gridline per 32 px at most; 96 px holds four.
 */
const GRAPH_WIDTH = 300;
const GRAPH_HEIGHT = 96;

/** A gold label beside its gridline, kept inside the plot at the top and bottom. */
function yLabelStyle({ offset, align }: GoldYAxis["lines"][number]): CSSProperties {
  if (align === "start") return { bottom: 0 };
  if (align === "end") return { top: 0 };
  return { bottom: offset - AXIS_LABEL_HEIGHT / 2 };
}

/** A date under its mark, kept inside the plot at the left and right. */
function xLabelStyle({ offset, align }: GoldXTick): CSSProperties {
  if (align === "start") return { left: 0 };
  if (align === "end") return { right: 0 };
  return { left: offset, transform: "translateX(-50%)" };
}

/**
 * The selection's gold over the period, as the in-game Dashboard's graph:
 * one line through the engine's samples (Retail's 1,000 g steps as
 * recorded, which a note under the line names on Retail) over the
 * Dashboard's gridlines, gold labels and dates (tsmGoldAxes), then the
 * 52-week High and Low and the daily change. One focus stop (G3), so the
 * D-pad scrolls past it.
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
  // samples its own graph (a step per 3 px), and the axes space their
  // labels by it.
  const plot = useRef<SVGSVGElement>(null);
  const width = useSyncExternalStore(ledgerPlotWidth.subscribe, ledgerPlotWidth.get) ?? GRAPH_WIDTH;
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
  const last = gold.points[gold.points.length - 1]![0];
  const span = last - first;
  // Green when the period ends at or above where it started, else red, as
  // the in-game graph colours its line (owner, 2026-11-25). The line's own
  // slope says the same without colour (S13).
  const rising = values[0]! <= values[values.length - 1]!;
  const colour = rising ? STEAM.positive : STEAM.danger;
  const yAxis = goldYAxis(values, GRAPH_HEIGHT, retail);
  const xTicks = goldXAxis(first, last, width);
  const y = (copper: number) =>
    GRAPH_HEIGHT - ((copper - yAxis.min) / (yAxis.max - yAxis.min)) * GRAPH_HEIGHT;
  const x = (ms: number) => (span === 0 ? 0 : ((ms - first) / span) * width);
  // One point (a first balance logged this minute) is a flat line across.
  const line =
    gold.points.length === 1
      ? `0,${y(values[0]!)} ${width},${y(values[0]!)}`
      : gold.points.map(([ms, copper]) => `${x(ms)},${y(copper)}`).join(" ");
  // The area under the line, closed along the bottom of the box.
  const area = `${line} ${width},${GRAPH_HEIGHT} 0,${GRAPH_HEIGHT}`;
  const start = dayMonth(new Date(first), new Date(now));
  // The widest gold label sizes the label column.
  const widest = yAxis.lines.reduce((a, b) => (b.label.length > a.length ? b.label : a), "");
  return (
    <PanelSectionRow>
      <Field
        focusable
        label="Gold"
        childrenLayout="below"
        {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.gold)}
      >
        <div className="wowdeck-ledger-gold">
          <div className="wowdeck-ledger-graph">
            <div
              className="wowdeck-ledger-yaxis"
              style={{ height: GRAPH_HEIGHT }}
              aria-hidden="true"
            >
              <span className="wowdeck-ledger-axis-sizer">{widest}</span>
              {yAxis.lines.map((gridline) => (
                <span key={gridline.copper} style={yLabelStyle(gridline)}>
                  {gridline.label}
                </span>
              ))}
            </div>
            <svg
              ref={plot}
              role="img"
              aria-label={`Gold from ${start} to now, between ${formatMoney(low)} and ${formatMoney(high)}`}
              viewBox={`0 0 ${width} ${GRAPH_HEIGHT}`}
              preserveAspectRatio="none"
              style={{ height: GRAPH_HEIGHT }}
            >
              {/* A soft fill under the line in its colour, fading out
                  towards the bottom (owner, PR #318 review). */}
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={colour} stopOpacity={0.35} />
                  <stop offset="1" stopColor={colour} stopOpacity={0} />
                </linearGradient>
              </defs>
              {yAxis.lines.map((gridline) => (
                <line
                  key={gridline.copper}
                  className="wowdeck-ledger-gridline"
                  x1={0}
                  x2={width}
                  y1={GRAPH_HEIGHT - gridline.offset}
                  y2={GRAPH_HEIGHT - gridline.offset}
                  stroke={STEAM.textDisabled}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  shapeRendering="crispEdges"
                />
              ))}
              <polygon points={area} fill={`url(#${fillId})`} stroke="none" />
              <polyline
                points={line}
                fill="none"
                stroke={colour}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span />
            <div className="wowdeck-ledger-xaxis" aria-hidden="true">
              {xTicks.map((tick) => (
                <span key={tick.at} style={xLabelStyle(tick)}>
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {retail && (
            <div className="wowdeck-ledger-note">Retail records your gold in steps of 1,000g</div>
          )}
          <Line label="52-week high">
            <Money copper={dashboardMoney(gold.high, retail)} />
          </Line>
          <Line label="52-week low">
            <Money copper={dashboardMoney(gold.low, retail)} />
          </Line>
          <Line label="Daily change">
            <Money copper={dashboardSummaryMoney(gold.dailyChange, retail)} />
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
 * grid, then the Sales, Expenses and Profit table, rounded as the
 * Dashboard rounds them (tsmLedgerMoney).
 */
function Figures({ figures, retail }: { figures: TradeSkillMasterLedgerFigures; retail: boolean }) {
  const cells: [string, ReactNode][] = [
    ["Avg daily sales", perDay(figures.dailySales)],
    ["Avg daily purchases", perDay(figures.dailyPurchases)],
    ["Top sale", <Money copper={dashboardSummaryMoney(figures.topSale, retail)} />],
    ["Top purchase", <Money copper={dashboardSummaryMoney(figures.topPurchase, retail)} />],
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
      <FlowTable figures={figures} retail={retail} />
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
              <Figures figures={data.figures} retail={data.retail} />
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
