import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { useTsmLedger } from "../tsmReads";
import { ledgerPlotWidth, pickLedgerFilter } from "../tsmLedgerFilters";
import { STEAM } from "../steamTheme";
import { openLedgerItems } from "./TsmLedgerItemsModal";
import { focusTarget } from "./FocusSlot";
import { SegmentRow, type BarSegment } from "./BrowseBar";
import { SegmentMenu } from "./SegmentMenu";
import {
  LEDGER_HALF_VALUE,
  LEDGER_PAIR_VALUE,
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
  recorded: "ledger-recorded",
  empty: "ledger-empty",
  account: "ledger-account",
  realm: "ledger-realm",
  character: "ledger-character",
  period: "ledger-period",
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
 * 2026-10-23). Up and Down between the rows are Steam's own. Export takes
 * no focus until it works (phase 2), so it needs no entry yet.
 */
export const LEDGER_LEFT_NEIGHBOUR: Record<string, string> = {
  [LEDGER_FOCUS.character]: LEDGER_FOCUS.realm,
  [LEDGER_FOCUS.period]: LEDGER_FOCUS.character,
};

/** The in-game Dashboard's periods, in its order. */
const PERIODS: TradeSkillMasterLedgerPeriod[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "All"];

/**
 * The Ledger's filter bar (ADR 0002, G14): the browse bar's segments with
 * in-pane menus, floating with the pill bar (S24) in two rows. Realm,
 * Character and Period come first, once the account has records. The second
 * row holds Account, only with more than one account, and Export, shown
 * whatever the Ledger holds. Until Export works (phase 2) it is disabled and
 * takes no focus: Steam's navigation stopped on the disabled button although
 * A did nothing there (DEVICE 2026-11-24), and its text is always in view.
 */
export function TsmLedgerFilters({ installationId }: { installationId: string }) {
  const { data } = useTsmLedger(installationId);
  const exportSegment: BarSegment = {
    id: "export",
    caption: "Export",
    menu: (
      <DialogButton disabled focusable={false} onClick={() => {}} style={{ width: "100%" }}>
        {/* The whole sentence, wrapping beside Account (S27): an ellipsis
            cut it to "Export arrives in the n…" (DEVICE 2026-11-24). */}
        <span style={{ display: "block", whiteSpace: "normal" }}>
          Export arrives in the next update
        </span>
      </DialogButton>
    ),
  };
  if (!data) {
    return <SegmentRow view={FOCUS_VIEW} segments={[exportSegment]} />;
  }
  const pick = (change: Parameters<typeof pickLedgerFilter>[2]) =>
    pickLedgerFilter(installationId, data, change);
  const account: BarSegment = {
    id: "account",
    caption: "Account",
    focusId: LEDGER_FOCUS.account,
    menu: (
      <SegmentMenu
        menuLabel="Account"
        choices={data.accounts.map((name) => ({ data: name, label: name }))}
        selected={data.account}
        renderValue={LEDGER_PAIR_VALUE}
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
            ...data.realms.map((realm) => ({ data: realm as string | null, label: realm })),
          ]}
          selected={data.realm}
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
            ...data.characters.map((c) => ({ data: c.id as string | null, label: c.label })),
          ]}
          selected={data.character}
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
          selected={data.period}
          renderValue={LEDGER_PERIOD_VALUE}
          onPick={(period) => pick({ period })}
        />
      ),
    },
  ];
  return (
    <>
      {data.state === "ready" && <SegmentRow view={FOCUS_VIEW} segments={filters} />}
      <SegmentRow
        view={FOCUS_VIEW}
        segments={data.accounts.length > 1 ? [account, exportSegment] : [exportSegment]}
      />
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

/** Money as WoW writes it; a loss in Steam's danger colour. */
const Money = ({ copper }: { copper: number }) => (
  <span style={Math.round(copper) < 0 ? { color: STEAM.danger } : undefined}>
    {formatMoney(copper)}
  </span>
);

/**
 * Sales, Expenses or Profit, as the in-game Dashboard's rows: total with its
 * trend, the average per day and the top item. One focus stop (G3).
 */
function FlowPanel({
  heading,
  totalLabel,
  flow,
  upIsGood,
  focusKey,
}: {
  heading: string;
  totalLabel: string;
  flow: TradeSkillMasterLedgerFlow;
  upIsGood: boolean;
  focusKey: string;
}) {
  return (
    <PanelSectionRow>
      <div className="wowdeck-ledger-panel">
        <Field
          focusable
          label={heading}
          childrenLayout="below"
          {...focusTarget(FOCUS_VIEW, focusKey)}
        >
          <Line label={totalLabel}>
            <Trend change={flow.trend} upIsGood={upIsGood} />
            <Money copper={flow.total} />
          </Line>
          <Line label="Per day">
            <Money copper={flow.perDay} />
          </Line>
          <Line label="Top item">
            <span className="wowdeck-ledger-item">
              {flow.topItemName ?? flow.topItem ?? "None"}
            </span>
          </Line>
        </Field>
      </div>
    </PanelSectionRow>
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
 * The figures under the freshness line: the four that are not the graph's
 * in a 2×2 grid, then Sales, Expenses and Profit stacked.
 */
function Figures({ figures }: { figures: TradeSkillMasterLedgerFigures }) {
  const cells: [string, string][] = [
    ["Avg daily sales", perDay(figures.dailySales)],
    ["Avg daily purchases", perDay(figures.dailyPurchases)],
    ["Top sale", formatMoney(figures.topSale)],
    ["Top purchase", formatMoney(figures.topPurchase)],
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
      <FlowPanel
        heading="Sales"
        totalLabel="Total earned"
        flow={figures.earned}
        upIsGood
        focusKey={LEDGER_FOCUS.sales}
      />
      <FlowPanel
        heading="Expenses"
        totalLabel="Total spent"
        flow={figures.spent}
        upIsGood={false}
        focusKey={LEDGER_FOCUS.expenses}
      />
      <FlowPanel
        heading="Profit"
        totalLabel="Total profit"
        flow={figures.profit}
        upIsGood
        focusKey={LEDGER_FOCUS.profit}
      />
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
          {/* Without the addon nothing records, so nothing is dated. */}
          {data.recordedAt !== null && data.state !== "noAddon" && (
            <PanelSectionRow>
              {/* Focusable, so the D-pad reaches the top of the view (G3). */}
              <Field
                focusable
                label={`Recorded at last logout · ${formatWhen(data.recordedAt, now)}`}
                description={
                  data.gameRunning ? "Log out or /reload to include this session" : undefined
                }
                {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.recorded)}
              />
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
