<template>
    <div class="stepper-root">

        <!-- Controls stay outside everything else: "next" is pressed far more
             often than anything else here, so it must never scroll away. -->
        <div class="action-bar">
            <label class="inline-field">symbol
                <input list="stepper-symbol-list" v-model="symbolInput" :disabled="busy" class="text-input" placeholder="BTCUSDT" />
                <datalist id="stepper-symbol-list">
                    <option v-for="s in availableSymbols" :key="s" :value="s"></option>
                </datalist>
            </label>
            <label class="inline-field">start date/time
                <input type="datetime-local" v-model="startDateTimeInput" :disabled="busy" class="datetime-input" />
            </label>
            <label class="inline-field">window
                <input type="number" v-model.number="windowSizeInput" :disabled="busy || session != null" class="num-input" />
            </label>
            <ButtonComponent rounded color="primary" :disabled="!canStart" @click="start">
                {{ session ? 'restart' : 'start' }}
            </ButtonComponent>
            <ButtonComponent rounded color="ghost" :disabled="!canStep" @click="step(1)">next</ButtonComponent>
            <ButtonComponent rounded color="ghost" :disabled="!canStep" @click="step(10)">next ×10</ButtonComponent>
            <ButtonComponent rounded color="ghost" :disabled="!canStep" @click="step(50)">next ×50</ButtonComponent>
            <ButtonComponent rounded color="ghost" :disabled="!session || busy" @click="copyCurrentCandle">copy candle</ButtonComponent>
            <ButtonComponent rounded color="ghost" :disabled="!session || busy" @click="copyRecent">copy last 25</ButtonComponent>
            <ButtonComponent rounded color="ghost" :disabled="!session || busy" @click="checkDivergence">
                {{ divergenceRunning ? 'comparing…' : 'compare to full re-derive' }}
            </ButtonComponent>
        </div>

        <div class="status-line">
            <template v-if="!session">
                Pick a symbol and a start date, then press start. The first
                {{ windowSizeInput }} candles are warm-up history — the walk begins at the
                candle after them.
            </template>
            <template v-else>
                <strong>{{ session.symbol }}</strong>
                · candle <strong>{{ absoluteIndex }}</strong>
                (window index {{ session.symbolInfo.candle_15m.length - 1 }})
                · {{ currentCandle ? new Date(currentCandle.openTime).toLocaleString() : '—' }}
                · {{ session.stepped }} step{{ session.stepped === 1 ? '' : 's' }}
                <span v-if="busy"> · working…</span>
            </template>
        </div>
        <div class="status-line warn" v-if="session && session.exhausted && session.exhaustedReason">
            ⛔ walk stopped: {{ session.exhaustedReason }}
        </div>
        <div class="status-line warn" v-if="errorMessage">⚠ {{ errorMessage }}</div>
        <div class="status-line hint" v-if="copyMessage">{{ copyMessage }}</div>

        <div class="row" v-if="session && currentCandle">

            <!-- ── the candle itself ─────────────────────────────────────── -->
            <div class="col-lg-4 col-md-6 pa-md">
                <div class="panel">
                    <div class="panel-title">Candle</div>
                    <div class="kv"><span>open time</span><span>{{ new Date(currentCandle.openTime).toLocaleString() }}</span></div>
                    <div class="kv"><span>open</span><span>{{ fmtPrice(currentCandle.open) }}</span></div>
                    <div class="kv"><span>high</span><span>{{ fmtPrice(currentCandle.high) }}</span></div>
                    <div class="kv"><span>low</span><span>{{ fmtPrice(currentCandle.low) }}</span></div>
                    <div class="kv"><span>close</span>
                        <span :class="currentCandle.close >= currentCandle.open ? 'pos' : 'neg'">
                            {{ fmtPrice(currentCandle.close) }}
                            ({{ pct((currentCandle.close - currentCandle.open) / currentCandle.open) }})
                        </span>
                    </div>
                    <div class="kv"><span>quote volume</span><span>{{ fmtNum(currentCandle.volume, 0) }}</span></div>

                    <div class="panel-title mt">Scale</div>
                    <div class="kv"><span title="Period 8, not 14 — two hours on 15m.">ATR(8)</span>
                        <span>{{ fmtPrice(currentCandle.atr) }}</span></div>
                    <div class="kv"><span>ATR as % of price</span>
                        <span>{{ atrPercent != null ? pct(atrPercent) : '—' }}</span></div>
                    <div class="kv"><span>EMA200</span><span>{{ fmtPrice(currentCandle.ema200) }}</span></div>
                    <div class="kv"><span>close − EMA200, in ATR</span>
                        <span :class="emaDistanceAtr != null && emaDistanceAtr >= 0 ? 'pos' : 'neg'">
                            {{ emaDistanceAtr != null ? fmtNum(emaDistanceAtr, 2) : '—' }}
                        </span></div>

                    <!-- The one piece of arithmetic no entry can argue with.
                         Shown per candle because ATR here is period 8, so a
                         "3 ATR stop" is much tighter than it reads. -->
                    <div class="panel-title mt">What a stop costs here</div>
                    <table class="mini-table">
                        <thead><tr><th>stop</th><th>risk % of price</th><th>fee ÷ R</th><th>breakeven win rate</th></tr></thead>
                        <tbody>
                            <tr v-for="row in stopCostRows" :key="row.stopAtr">
                                <td>{{ row.stopAtr }} ATR</td>
                                <td>{{ row.riskPercent != null ? pct(row.riskPercent) : '—' }}</td>
                                <td :class="row.feePerR != null && row.feePerR >= 0.25 ? 'neg' : ''">
                                    {{ row.feePerR != null ? pct(row.feePerR) : '—' }}
                                </td>
                                <td>{{ row.breakevenWinRateAt2R != null ? pct(row.breakevenWinRateAt2R) : '—' }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="hint">
                        fee ÷ R = 2 × 0.05% ÷ (stop distance ÷ price). The last column is the
                        win rate a 2:1 planned payoff needs once that fee is paid, from
                        p = (1 + fee/R) ÷ (RR + 1 + fee/R) — arithmetic, not a measurement.
                    </div>
                </div>
            </div>

            <!-- ── what the entry hook is handed ─────────────────────────── -->
            <div class="col-lg-4 col-md-6 pa-md">
                <div class="panel">
                    <div class="panel-title">checkPositionEntry arguments</div>
                    <div class="kv"><span>gi (window index)</span><span>{{ session.symbolInfo.candle_15m.length - 1 }}</span></div>
                    <div class="kv"><span>reversingDirection</span>
                        <span>{{ entryInputs.reversingDirection ?? 'null' }}</span></div>
                    <div class="kv"><span>reversingSegmentStartGi</span>
                        <span>{{ entryInputs.reversingSegmentStartGi ?? 'null' }}</span></div>
                    <div class="kv"><span>margin / leverage</span>
                        <span>{{ fmtNum(session.positionMargin, 2) }} / {{ DEFAULT_LEVERAGE }}×</span></div>
                    <div class="warn-note" v-if="startTruncated">
                        ⚠ segment start sits at the window edge, so it is a FLOOR, not the pivot.
                        Anything measured from it — segment high, low, mid, where this candle sits
                        inside the segment — describes only the part still in the window.
                    </div>
                    <div class="kv"><span>segment end (endGi)</span>
                        <span>{{ entryInputs.snapshotEndGi ?? 'null' }}</span></div>
                    <div class="kv"><span title="Candles between the segment's own pivot and the candle that confirmed it — how much hindsight the label needed.">confirmation lag</span>
                        <span>{{ entryInputs.confirmationLagCandles ?? '—' }}</span></div>

                    <div class="panel-title mt">Entry result</div>
                    <div class="kv"><span>returned</span>
                        <span>{{ lastEntryResult }}</span></div>
                    <div class="hint" v-if="lastEntryResult === 'null'">
                        checkPositionEntry is a blank stub. Encode the entry there and it fires
                        here first, one candle at a time, before the rolling lab is asked to
                        measure it across every symbol.
                    </div>

                    <div class="panel-title mt">Trend segment (as finally labelled)</div>
                    <div class="kv"><span>direction</span><span>{{ currentCandle.trendState?.direction ?? 'none' }}</span></div>
                    <div class="kv"><span>startGi → endGi</span>
                        <span>{{ currentCandle.trendState ? currentCandle.trendState.startGi + ' → ' + currentCandle.trendState.endGi : '—' }}</span></div>
                    <div class="hint">
                        This field is rewritten on earlier candles whenever the segment's extreme
                        extends, so late in a run it shows the hindsight-complete segment. The
                        arguments above are the snapshot as of THIS candle and are the honest
                        version.
                    </div>

                    <div class="panel-title mt">Conditions met</div>
                    <div v-if="!currentCandle.conditions_met?.length" class="hint">none</div>
                    <div class="chips" v-else>
                        <span class="chip" v-for="c in currentCandle.conditions_met" :key="c">{{ c }}</span>
                    </div>

                    <div class="panel-title mt">Market structure confirmed here</div>
                    <div v-if="!newlyConfirmed" class="hint">nothing — no swing became knowable at this candle</div>
                    <div v-else class="kv"><span>{{ newlyConfirmed.label }}</span>
                        <span>on the candle at index {{ newlyConfirmed.atIndex }}</span></div>
                </div>
            </div>

            <!-- ── derived context ──────────────────────────────────────── -->
            <div class="col-lg-4 col-md-6 pa-md">
                <div class="panel">
                    <div class="panel-title">Candle structure</div>
                    <div class="kv"><span>direction</span><span>{{ currentCandle.candleStructure?.direction ?? '—' }}</span></div>
                    <div class="kv"><span>body / range</span><span>{{ fmtNum(currentCandle.candleStructure?.bodyRatio, 2) }}</span></div>
                    <div class="kv"><span>upper / lower wick</span>
                        <span>{{ fmtNum(currentCandle.candleStructure?.upperWickRatio, 2) }} / {{ fmtNum(currentCandle.candleStructure?.lowerWickRatio, 2) }}</span></div>
                    <div class="kv"><span title="0 = closed at the low, 1 = closed at the high.">close location</span>
                        <span>{{ fmtNum(currentCandle.candleStructure?.closeLocation, 2) }}</span></div>
                    <div class="kv"><span>range ÷ ATR</span><span>{{ fmtNum(currentCandle.candleStructure?.rangeAtrRatio, 2) }}</span></div>
                    <div class="kv"><span>consecutive bull / bear</span>
                        <span>{{ currentCandle.candleStructure?.consecutiveBullish ?? '—' }} / {{ currentCandle.candleStructure?.consecutiveBearish ?? '—' }}</span></div>
                    <div class="chips">
                        <span class="chip" v-for="f in structureFlags" :key="f">{{ f }}</span>
                    </div>

                    <div class="panel-title mt">Volume</div>
                    <div class="kv"><span>relative volume</span><span>{{ fmtNum(currentCandle.volumeState?.relativeVolume, 2) }}</span></div>
                    <div class="kv"><span>z vs rolling baseline</span><span>{{ fmtNum(currentCandle.volumeState?.dynamicZScore, 2) }}</span></div>
                    <div class="kv"><span>z vs this segment</span><span>{{ fmtNum(currentCandle.volumeState?.trendZScore, 2) }}</span></div>
                    <div class="kv"><span>state</span><span>{{ currentCandle.volumeState?.state ?? '—' }}</span></div>

                    <div class="panel-title mt">Price action</div>
                    <div class="kv"><span>dominant</span><span>{{ currentCandle.priceAction?.dominant ?? '—' }}</span></div>
                    <div class="kv"><span>strength</span><span>{{ fmtNum(currentCandle.priceAction?.strength, 2) }}</span></div>
                    <div class="chips">
                        <span class="chip" v-for="e in priceActionEvents" :key="e">{{ e }}</span>
                        <span class="hint" v-if="!priceActionEvents.length">no events detected</span>
                    </div>

                    <div class="panel-title mt">POC AVWAP anchors</div>
                    <div v-if="!anchors.length" class="hint">
                        none yet — anchors are added two at a time when a trend segment commits.
                    </div>
                    <table class="mini-table" v-else>
                        <thead><tr><th>anchor</th><th>side</th><th>AVWAP</th><th>close − AVWAP (ATR)</th></tr></thead>
                        <tbody>
                            <tr v-for="(a, i) in anchors" :key="i">
                                <td>
                                    {{ a.absoluteGi }}
                                    <span class="warn" v-if="a.truncated" title="Anchor candle has aged out of the window; the AVWAP is accumulating from the window edge, not from the event.">⚠</span>
                                </td>
                                <td>{{ a.direction }}</td>
                                <td>{{ fmtPrice(a.value) }}</td>
                                <td :class="a.distanceAtr != null && a.distanceAtr >= 0 ? 'pos' : 'neg'">
                                    {{ a.distanceAtr != null ? fmtNum(a.distanceAtr, 2) : '—' }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ── positions ────────────────────────────────────────────────── -->
        <div class="pa-md" v-if="session && (session.openPosition || session.closedPositions.length)">
            <div class="panel">
                <div class="panel-title">Positions</div>
                <table class="mini-table">
                    <thead>
                        <tr>
                            <th>state</th><th>side</th><th>opened</th><th>entry</th><th>sl</th><th>tp</th>
                            <th>planned R:R</th><th>risk %</th><th>gross pnl</th><th>close</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(p, i) in positionRows" :key="i" :class="p.status === 'OPEN' ? '' : (p.pnl != null && p.pnl >= 0 ? 'row-pos' : 'row-neg')">
                            <td>{{ p.status }}</td>
                            <td>{{ p.side }}</td>
                            <td>{{ new Date(p.openTime).toLocaleString() }}</td>
                            <td>{{ fmtPrice(p.entryPrice) }}</td>
                            <td>{{ fmtPrice(p.sl) }}</td>
                            <td>{{ fmtPrice(p.tp) }}</td>
                            <td>{{ fmtNum(p.entryReason.plannedRewardRisk, 2) }}</td>
                            <td>{{ pct(p.entryReason.plannedRiskPercent) }}</td>
                            <td :class="p.pnl != null && p.pnl >= 0 ? 'pos' : 'neg'">{{ p.pnl != null ? fmtNum(p.pnl, 4) : '—' }}</td>
                            <td>{{ p.closeReason ?? '' }}</td>
                        </tr>
                    </tbody>
                </table>
                <div class="hint">
                    pnl is GROSS. Entry fee {{ fmtNum(totalEntryFees, 4) }} and exit fee
                    {{ fmtNum(totalExitFees, 4) }} are charged separately, and funding is not
                    modelled in this stepper at all — the rolling lab is where costs are priced.
                </div>
            </div>
        </div>

        <!-- ── divergence diagnostic ────────────────────────────────────── -->
        <div class="pa-md" v-if="divergenceChecked">
            <div class="panel">
                <div class="panel-title">This walk vs. a full re-derive of the same window</div>
                <div v-if="!divergence.length" class="hint">
                    No difference at this candle on any compared field. This walk carries its
                    derivation state across every shift; a full re-derive restarts it from the
                    window's first candle. Where they agree, a threshold found here carries to
                    the rolling lab unchanged.
                </div>
                <table class="mini-table" v-else>
                    <thead><tr><th>field</th><th>this walk</th><th>full re-derive</th><th>difference</th></tr></thead>
                    <tbody>
                        <tr v-for="d in divergence" :key="d.field">
                            <td>{{ d.field }}</td>
                            <td>{{ d.resumed }}</td>
                            <td>{{ d.rederived }}</td>
                            <td>{{ d.absoluteDifference != null ? d.absoluteDifference.toExponential(3) : '' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- ── recent candles ───────────────────────────────────────────── -->
        <div class="pa-md" v-if="session && recentRows.length">
            <div class="panel">
                <div class="panel-title">Last {{ recentRows.length }} candles (newest first)</div>
                <div class="table-scroll">
                    <table class="mini-table">
                        <thead>
                            <tr><th>index</th><th>time</th><th>close</th><th>ATR</th><th>rel vol</th><th>trend</th><th>conditions</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in recentRows" :key="row.openTime" :class="{ 'row-current': row.isCurrent }">
                                <td>{{ row.absoluteGi }}</td>
                                <td>{{ new Date(row.openTime).toLocaleString() }}</td>
                                <td :class="row.up ? 'pos' : 'neg'">{{ fmtPrice(row.close) }}</td>
                                <td>{{ fmtPrice(row.atr) }}</td>
                                <td>{{ fmtNum(row.relativeVolume, 2) }}</td>
                                <td>{{ row.trend }}</td>
                                <td class="cond-cell">{{ row.conditions }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * MANUAL CANDLE STEPPER — the study surface for the entry.
 *
 * The rolling lab walks every symbol automatically and reports aggregates. This
 * walks ONE symbol, one candle per press, and shows what the entry hook is
 * handed at that candle. It measures nothing and concludes nothing: it exists so
 * an entry can be written from observation instead of from a formula.
 *
 * All walk logic lives in candleStepperSession.ts - a pure module with no Vue
 * dependency, runnable against a parsed export, tested separately. This file is
 * presentation and nothing else, which is why every number below is either read
 * straight off a candle or computed by a named function from that module.
 *
 * NO LOOK-AHEAD IS POSSIBLE HERE, structurally rather than by discipline: the
 * window is built by appending one candle at a time, so it never contains a
 * candle after the current one.
 */
import { computed, ref } from 'vue';
import ButtonComponent from '../../shared/form/ButtonComponent.vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import type { CandleInfo, PositionEntry, MarketStructureLabel } from '@/core/interfacesv2';
import { DEFAULT_LEVERAGE } from '@/utility/v2/analysis/positionEntry';
import {
    startSession, stepSession, entryInputsFromCarry, segmentStartTruncated, readAnchors,
    feePerR, divergenceAgainstFullRederive,
    STEPPER_WINDOW_SIZE,
    type StepperSession, type AnchorReadout, type FieldDivergence, type EntryInputs,
} from '@/utility/v2/candleStepperSession';

const chocoMintoStore = useChocoMintoStore();

const symbolInput = ref('BTCUSDT');
const startDateTimeInput = ref('');
const windowSizeInput = ref(STEPPER_WINDOW_SIZE);

// shallowRef is deliberate elsewhere in this app for 500-candle windows; here the
// session object is swapped wholesale on every step (see `touch`), so a plain ref
// with an explicit version counter is simpler and avoids deep-watching 500
// candles each carrying every analysis field.
const session = ref<StepperSession | null>(null);
const version = ref(0);
const busy = ref(false);
const errorMessage = ref('');
const copyMessage = ref('');
const lastEntryResult = ref('—');

const divergence = ref<FieldDivergence[]>([]);
const divergenceChecked = ref(false);
const divergenceRunning = ref(false);

/** Forces the computeds below to re-read the mutated window. The session's
 *  candle array is mutated in place by the walk (that is what makes resuming
 *  possible), so Vue has nothing to notice on its own. */
function touch(): void { version.value++; }

const availableSymbols = computed(() => chocoMintoStore.futureSymbols.map(s => s.symbol));

const canStart = computed(() => !busy.value && symbolInput.value.trim().length > 0 && startDateTimeInput.value !== '');
const canStep = computed(() => !busy.value && session.value != null && !session.value.exhausted);

const currentCandle = computed<CandleInfo | null>(() => {
    void version.value;
    const w = session.value?.symbolInfo.candle_15m;
    return w && w.length ? w[w.length - 1] : null;
});

const absoluteIndex = computed(() => {
    void version.value;
    const s = session.value;
    if (!s) return 0;
    return s.shiftedOff + s.symbolInfo.candle_15m.length - 1;
});

const entryInputs = computed<EntryInputs>(() => {
    void version.value;
    const s = session.value;
    if (!s) {
        return { reversingDirection: null, reversingSegmentStartGi: null, snapshotEndGi: null,
                 snapshotConfirmedOpenTime: null, confirmationLagCandles: null };
    }
    return entryInputsFromCarry(s);
});

const startTruncated = computed(() => {
    void version.value;
    const s = session.value;
    return s != null && segmentStartTruncated(s, entryInputs.value.reversingSegmentStartGi);
});

const anchors = computed<AnchorReadout[]>(() => {
    void version.value;
    return session.value ? readAnchors(session.value) : [];
});

const atrPercent = computed(() => {
    const c = currentCandle.value;
    if (!c || !(c.close > 0) || !(c.atr > 0)) return null;
    return c.atr / c.close;
});

const emaDistanceAtr = computed(() => {
    const c = currentCandle.value;
    if (!c || !(c.atr > 0) || !(c.ema200 > 0)) return null;
    return (c.close - c.ema200) / c.atr;
});

/**
 * Stop widths and what they cost, at this candle's own ATR.
 *
 * THE STOP WIDTHS ARE ARBITRARY - 1, 2, 3 and 5 ATR are round numbers, not a
 * calibration. The COSTS are not arbitrary: they are arithmetic from the taker
 * fee and the stop distance, and they hold whatever the entry turns out to be.
 * The last column inverts the breakeven identity for a fixed 2:1 payoff, so the
 * fee shows up as a win rate rather than as a fraction of R.
 */
const STOP_ATRS = [1, 2, 3, 5];
const REFERENCE_RR = 2;
const stopCostRows = computed(() => {
    const c = currentCandle.value;
    return STOP_ATRS.map(stopAtr => {
        if (!c) return { stopAtr, riskPercent: null, feePerR: null, breakevenWinRateAt2R: null };
        const riskPercent = c.close > 0 && c.atr > 0 ? (stopAtr * c.atr) / c.close : null;
        const fee = feePerR(c, stopAtr);
        // Net of fee, a win returns RR - fee/R and a loss costs 1 + fee/R, so
        // breakeven p solves p(RR - f) = (1 - p)(1 + f).
        const breakevenWinRateAt2R = fee != null && REFERENCE_RR - fee > 0
            ? (1 + fee) / (REFERENCE_RR + 1)
            : null;
        return { stopAtr, riskPercent, feePerR: fee, breakevenWinRateAt2R };
    });
});

const structureFlags = computed(() => {
    const s = currentCandle.value?.candleStructure;
    if (!s) return [];
    const flags: string[] = [];
    if (s.isDoji) flags.push('doji');
    if (s.isExpansion) flags.push('expansion');
    if (s.isCompression) flags.push('compression');
    if (s.isInsideBar) flags.push('inside bar');
    if (s.isOutsideBar) flags.push('outside bar');
    if (s.isBullishEngulfing) flags.push('bullish engulfing');
    if (s.isBearishEngulfing) flags.push('bearish engulfing');
    return flags;
});

const priceActionEvents = computed(() => {
    const p = currentCandle.value?.priceAction;
    if (!p) return [];
    const events: string[] = [];
    if (p.displacement?.detected) events.push('displacement');
    if (p.rejection?.detected) events.push('rejection');
    if (p.reclaim?.detected) events.push('reclaim');
    if (p.breakout?.detected) events.push('breakout');
    if (p.failedBreakout?.detected) events.push('failed breakout');
    if (p.liquiditySweep?.detected) events.push('liquidity sweep');
    return events;
});

/**
 * A swing label that became knowable AT this candle.
 *
 * The label itself lives on the candle two back (the fractal needs two candles
 * on either side), and `confirmedOpenTime` on it is the moment it became
 * knowable — this candle's own openTime. So a label is "new here" exactly when
 * that time matches.
 */
const newlyConfirmed = computed<{ label: MarketStructureLabel; atIndex: number } | null>(() => {
    void version.value;
    const s = session.value;
    const c = currentCandle.value;
    if (!s || !c) return null;
    const w = s.symbolInfo.candle_15m;
    for (let i = w.length - 1; i >= Math.max(0, w.length - 6); i--) {
        const ms = w[i].marketStructure;
        if (ms && ms.confirmedOpenTime === c.openTime) {
            return { label: ms.label, atIndex: i + s.shiftedOff };
        }
    }
    return null;
});

const positionRows = computed<PositionEntry[]>(() => {
    void version.value;
    const s = session.value;
    if (!s) return [];
    const rows = [...s.closedPositions];
    if (s.openPosition) rows.push(s.openPosition);
    return rows.reverse();
});
const totalEntryFees = computed(() => positionRows.value.reduce((a, p) => a + (p.entryFee ?? 0), 0));
const totalExitFees = computed(() => positionRows.value.reduce((a, p) => a + (p.exitFee ?? 0), 0));

const RECENT_ROWS = 25;
const recentRows = computed(() => {
    void version.value;
    const s = session.value;
    if (!s) return [];
    const w = s.symbolInfo.candle_15m;
    const out: Array<{
        openTime: number; absoluteGi: number; close: number; atr: number;
        relativeVolume: number | undefined; trend: string; conditions: string;
        up: boolean; isCurrent: boolean;
    }> = [];
    for (let i = w.length - 1; i >= Math.max(0, w.length - RECENT_ROWS); i--) {
        const c = w[i];
        out.push({
            openTime: c.openTime,
            absoluteGi: i + s.shiftedOff,
            close: c.close,
            atr: c.atr,
            relativeVolume: c.volumeState?.relativeVolume,
            trend: c.trendState ? c.trendState.direction : '',
            conditions: (c.conditions_met ?? []).join(' '),
            up: c.close >= c.open,
            isCurrent: i === w.length - 1,
        });
    }
    return out;
});

async function start(): Promise<void> {
    errorMessage.value = '';
    copyMessage.value = '';
    divergenceChecked.value = false;
    divergence.value = [];
    const startMs = new Date(startDateTimeInput.value).getTime();
    if (!Number.isFinite(startMs)) { errorMessage.value = 'start date/time is not a valid date'; return; }
    busy.value = true;
    try {
        const s = await startSession(symbolInput.value.trim().toUpperCase(), startMs, {
            windowSize: Math.max(2, Math.floor(windowSizeInput.value) || STEPPER_WINDOW_SIZE),
            positionMargin: 1,
        });
        session.value = s;
        lastEntryResult.value = '— (no step taken yet)';
        touch();
        if (s.exhausted && s.exhaustedReason) errorMessage.value = s.exhaustedReason;
    } catch (e) {
        errorMessage.value = e instanceof Error ? e.message : String(e);
    } finally {
        busy.value = false;
    }
}

async function step(count: number): Promise<void> {
    const s = session.value;
    if (!s) return;
    errorMessage.value = '';
    copyMessage.value = '';
    divergenceChecked.value = false;
    busy.value = true;
    try {
        for (let n = 0; n < count; n++) {
            const result = await stepSession(s);
            if (!result.candle) break;
            if (result.opened) lastEntryResult.value = `${result.opened.side} opened at ${result.opened.entryPrice}`;
            else if (result.closed) lastEntryResult.value = `previous position closed (${result.closed.status})`;
            else lastEntryResult.value = 'null';
            // Repainted between steps so a long run is visibly progressing
            // rather than looking frozen.
            touch();
            if (count > 1) await new Promise(resolve => setTimeout(resolve, 0));
        }
    } catch (e) {
        errorMessage.value = e instanceof Error ? e.message : String(e);
    } finally {
        touch();
        busy.value = false;
    }
}

async function checkDivergence(): Promise<void> {
    const s = session.value;
    if (!s) return;
    divergenceRunning.value = true;
    errorMessage.value = '';
    try {
        divergence.value = await divergenceAgainstFullRederive(s);
        divergenceChecked.value = true;
    } catch (e) {
        errorMessage.value = e instanceof Error ? e.message : String(e);
    } finally {
        divergenceRunning.value = false;
    }
}

/**
 * Copies the candle as JSON, every derived field included.
 *
 * This is the point of the whole panel: an entry is written by looking at what
 * was true at a candle, and the fields worth reading are more numerous than any
 * layout can show at once.
 */
async function copyCurrentCandle(): Promise<void> {
    const c = currentCandle.value;
    if (!c) return;
    await copy(JSON.stringify({
        symbol: session.value?.symbol,
        absoluteIndex: absoluteIndex.value,
        entryArguments: entryInputs.value,
        anchors: anchors.value,
        candle: c,
    }, replacer, 2), 'candle copied');
}

async function copyRecent(): Promise<void> {
    const s = session.value;
    if (!s) return;
    const w = s.symbolInfo.candle_15m;
    await copy(JSON.stringify({
        symbol: s.symbol,
        windowSize: s.windowSize,
        shiftedOff: s.shiftedOff,
        candles: w.slice(Math.max(0, w.length - RECENT_ROWS)),
    }, replacer, 2), `last ${Math.min(RECENT_ROWS, w.length)} candles copied`);
}

/**
 * PositionEntry is shared by every candle it spans, so serializing a window
 * would emit the same position once per candle and recurse through it. Replaced
 * with its identity instead; the Positions table above is where a position is
 * read in full.
 */
function replacer(key: string, value: unknown): unknown {
    if (key === 'positionEntry' && value && typeof value === 'object') {
        const p = value as PositionEntry;
        return { side: p.side, status: p.status, openGi: p.openGi, openTime: p.openTime };
    }
    return value;
}

async function copy(text: string, message: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        copyMessage.value = message;
    } catch {
        // A clipboard write can be refused (no permission, or the document is
        // not focused). Said plainly rather than silently doing nothing.
        copyMessage.value = 'clipboard refused the write — check the browser permission';
    }
}

function fmtNum(v: number | null | undefined, digits = 2): string {
    return v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);
}
/** Prices span eight orders of magnitude across these symbols, so a fixed
 *  decimal count is unreadable at one end or lossy at the other. */
function fmtPrice(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    const digits = abs === 0 ? 2 : abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
    return v.toFixed(digits);
}
function pct(v: number | null | undefined, digits = 2): string {
    return v == null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(digits) + '%';
}
</script>

<style scoped>
.stepper-root {
  max-height: 90vh;
  overflow-y: auto;
  text-align: left;
}

.action-bar {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.5rem;
}

.inline-field {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.8rem;
  color: #6b7280;
}

.datetime-input,
.text-input,
.num-input {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  border-radius: 5px;
  outline: none;
  border: 1px solid #e4e4e7;
  background: #fff;
}
.datetime-input:focus,
.text-input:focus,
.num-input:focus { border-color: #929292; }
.num-input { width: 5.5rem; }
.text-input { width: 9rem; }

.status-line {
  padding: 0.15rem 0.6rem;
  font-size: 0.85rem;
}
.status-line.warn { color: #b45309; }
.status-line.hint { color: #6b7280; }

.panel {
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  background: #fafafa;
}

.panel-title {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6b7280;
  margin-bottom: 0.3rem;
}
.panel-title.mt { margin-top: 0.85rem; }

.kv {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.85rem;
  padding: 0.08rem 0;
}
.kv > span:first-child { color: #6b7280; }
.kv > span:last-child { font-variant-numeric: tabular-nums; }

.hint { font-size: 0.78rem; color: #6b7280; margin-top: 0.25rem; }

/* A truncated segment start is not a routine note: everything geometric derived
   from it is measuring the window rather than the market. Two classes would be
   needed if .hint also applied here - it does not, so one is enough. */
.warn-note {
  font-size: 0.78rem;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 5px;
  padding: 0.3rem 0.4rem;
  margin: 0.3rem 0;
}
.warn { color: #b45309; }

.chips { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.25rem; }
.chip {
  font-size: 0.72rem;
  padding: 0.08rem 0.4rem;
  border: 1px solid #d4d4d8;
  border-radius: 999px;
  background: #fff;
}

.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.mini-table th {
  text-align: left;
  font-weight: 500;
  color: #6b7280;
  border-bottom: 1px solid #e4e4e7;
  padding: 0.15rem 0.3rem;
}
.mini-table td { padding: 0.12rem 0.3rem; border-bottom: 1px solid #f1f1f3; }
.cond-cell { font-size: 0.72rem; color: #52525b; }

.table-scroll { max-height: 22rem; overflow-y: auto; }

.row-current { background: #eef2ff; }
.row-pos td { background: #f0fdf4; }
.row-neg td { background: #fef2f2; }
.pos { color: #15803d; }
.neg { color: #b91c1c; }
</style>