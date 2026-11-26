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
import { Field, PanelSectionRow } from "@decky/ui";
import { FaCaretDown, FaCaretUp } from "react-icons/fa";
import type {
  TradeSkillMasterLedgerFigures,
  TradeSkillMasterLedgerFlow,
  TradeSkillMasterLedgerGold,
} from "../../backend/src/api/contracts";
import { ledgerPlotWidth } from "../tsmLedgerFilters";
import { descriptionStyle, STEAM } from "../steamTheme";
import {
  AXIS_LABEL_HEIGHT,
  goldXAxis,
  goldYAxis,
  type GoldXTick,
  type GoldYAxis,
} from "../tsmGoldAxes";
import { focusTarget } from "./FocusSlot";
import { Money } from "./Money";
import { dashboardMoney, dashboardSummaryMoney } from "../tsmLedgerMoney";
import { RECORDS_VIEW, RecordsView } from "./TsmRecords";
import { dayMonth, formatMoney, formatWhen } from "../text";

/** The Dashboard's own rows in the destination's focus memory (S21, R1). */
export const DASHBOARD_FOCUS = {
  gold: "dashboard-gold",
  averages: "dashboard-averages",
  sales: "dashboard-sales",
  expenses: "dashboard-expenses",
  profit: "dashboard-profit",
} as const;

/** A trend against the previous period: an arrow by shape and colour (S13). */
function Trend({ change, upIsGood }: { change: number | null; upIsGood: boolean }) {
  if (change === null || change === 0) {
    return null;
  }
  const up = change > 0;
  const Arrow = up ? FaCaretUp : FaCaretDown;
  return (
    <span
      className="wowdeck-dashboard-trend"
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
    <div className="wowdeck-dashboard-line">
      <span>{label}</span>
      <span className="wowdeck-dashboard-value">{children}</span>
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
    ["Sales", figures.earned, true, DASHBOARD_FOCUS.sales],
    ["Expenses", figures.spent, false, DASHBOARD_FOCUS.expenses],
    ["Profit", figures.profit, true, DASHBOARD_FOCUS.profit],
  ];
  return (
    <>
      <PanelSectionRow>
        <div className="wowdeck-dashboard-flows wowdeck-dashboard-caption">
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
            {...focusTarget(RECORDS_VIEW, focusKey)}
          >
            <div className="wowdeck-dashboard-flows">
              <span className="wowdeck-dashboard-flow-name">{heading}</span>
              <span className="wowdeck-dashboard-value">
                <Trend change={flow.trend} upIsGood={upIsGood} />
                <Money copper={dashboardMoney(flow.total, retail)} />
              </span>
              <span className="wowdeck-dashboard-value">
                <Trend change={flow.trend} upIsGood={upIsGood} />
                <Money copper={dashboardMoney(flow.perDay, retail)} />
              </span>
            </div>
            <div className="wowdeck-dashboard-note">
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
        <Field
          focusable
          label="No gold history"
          {...focusTarget(RECORDS_VIEW, DASHBOARD_FOCUS.gold)}
        />
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
        {...focusTarget(RECORDS_VIEW, DASHBOARD_FOCUS.gold)}
      >
        <div className="wowdeck-dashboard-gold">
          <div className="wowdeck-dashboard-graph">
            <div
              className="wowdeck-dashboard-yaxis"
              style={{ height: GRAPH_HEIGHT }}
              aria-hidden="true"
            >
              <span className="wowdeck-dashboard-axis-sizer">{widest}</span>
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
                  className="wowdeck-dashboard-gridline"
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
            <div className="wowdeck-dashboard-xaxis" aria-hidden="true">
              {xTicks.map((tick) => (
                <span key={tick.at} style={xLabelStyle(tick)}>
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {retail && (
            <div className="wowdeck-dashboard-note">
              Retail records your gold in steps of 1,000g
            </div>
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
        <Field
          focusable
          childrenLayout="below"
          {...focusTarget(RECORDS_VIEW, DASHBOARD_FOCUS.averages)}
        >
          <div className="wowdeck-dashboard-grid">
            {cells.map(([label, value]) => (
              <div key={label}>
                <div className="wowdeck-dashboard-caption">{label}</div>
                <div className="wowdeck-dashboard-value">{value}</div>
              </div>
            ))}
          </div>
        </Field>
      </PanelSectionRow>
      <FlowTable figures={figures} retail={retail} />
    </>
  );
}

/**
 * The Dashboard (GLOSSARY): the in-game Dashboard's figures for what the
 * TradeSkillMaster addon recorded for the active installation, read from
 * the game's saved settings. It needs no TradeSkillMaster sign-in and only
 * reads.
 */
export function TsmDashboard({ installationId }: { installationId: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <RecordsView installationId={installationId}>
      {(data) => (
        <>
          {/* Without the addon nothing records, so nothing is dated. Plain
              text with no focus stop (owner, PR #318 review): the controls
              above it already bring the top of the view into sight. */}
          {data.recordedAt !== null && data.state !== "noAddon" && (
            <PanelSectionRow>
              <div className="wowdeck-dashboard-recorded" style={descriptionStyle}>
                <div>Recorded at last logout · {formatWhen(data.recordedAt, now)}</div>
                {data.gameRunning && <div>Log out or /reload to include this session</div>}
              </div>
            </PanelSectionRow>
          )}
          {data.state === "ready" && data.figures && (
            <>
              <GoldGraph gold={data.gold} now={now} retail={data.retail} />
              <Figures figures={data.figures} retail={data.retail} />
            </>
          )}
        </>
      )}
    </RecordsView>
  );
}
