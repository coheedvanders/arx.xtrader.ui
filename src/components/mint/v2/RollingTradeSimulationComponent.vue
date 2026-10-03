<template>
    <div class="rolling-root">
        <!-- Actions stay OUTSIDE the tabs: pause, export and the window
             download all need to be reachable while watching the Account
             or Open Symbols tab, which is exactly when you'd use them.
             Only the parameter INPUTS moved into Settings. -->
        <div class="action-bar">
            <ButtonComponent rounded color="ghost" @click="runRollingSimulation" :disabled="isRunning || !startDateTimeInput">run trade simulation</ButtonComponent>
            <ButtonComponent rounded color="ghost" @click="togglePause" :disabled="!isRunning">{{ isPaused ? 'resume' : 'pause' }}</ButtonComponent>
            <ButtonComponent rounded color="ghost" @click="stopSimulation" :disabled="!isRunning">stop</ButtonComponent>
            <ButtonComponent rounded color="ghost" @click="resetRun" :disabled="isRunning">reset run</ButtonComponent>
            <ButtonComponent rounded color="ghost" @click="exportResult" :disabled="!canExport">export result</ButtonComponent>
            <ButtonComponent rounded color="ghost" @click="downloadFullRunData" :disabled="!canDownloadFullData">
                {{ fullDataDownloadInProgress ? 'bundling…' : 'download full data' }}
            </ButtonComponent>
            <ButtonComponent rounded color="ghost" @click="downloadAllSymbolWindows" :disabled="!canDownloadWindows">
                {{ windowDownloadInProgress ? 'downloading…' : 'download all symbols (this period)' }}
            </ButtonComponent>
            <label class="ml-sm" title="Live-like: every tick each symbol's latest 500 candles are analysed from scratch and checkPositionEntry alone decides an entry at the 500th candle. No position cap, budget or interest gate, no candle-life cap, and no auto-close / liquidation stop. Margin follows the margin settings (dynamic margin included).">
                <input type="checkbox" v-model="mimicRunSimulation" :disabled="isRunning" />
                positionEntry only (no gates)
            </label>
            <span class="ml-sm" v-if="!mimicRunSimulation">cap: <strong>{{ maxConcurrentPositionsInput }}</strong></span>
            <span class="ml-sm hint" v-if="!startDateTimeInput">set a start date/time in Settings to run</span>
        </div>

        <div class="text-center">{{ statusMessage }}</div>
        <div class="text-center" v-if="completionEstimateDisplay">
            {{ completionEstimateDisplay.progressPercent.toFixed(1) }}% —
            <template v-if="completionEstimateDisplay.estimatedCompletionTimestamp != null">
                est. completion: {{ new Date(completionEstimateDisplay.estimatedCompletionTimestamp).toLocaleString() }}
            </template>
            <template v-else-if="completionEstimateDisplay.observedMsPerCandle != null">
                (processing slower than real time is passing — no finite estimate yet)
            </template>
            <template v-else>
                (measuring rate...)
            </template>
        </div>

        <div class="row">
            <div class="col-lg-3 col-md-3 pa-md">
                <div class="live-panel" :class="{ 'live-danger': marginBalance <= 0 }">
                    <!-- Headline: equity and its distance from the starting
                         balance. Margin balance, not `balance` - balance alone
                         drops every time a position OPENS (margin moves out of
                         it), which reads as a loss when nothing was lost. -->
                    <div class="live-headline">
                        <div class="live-headline-label">Margin Balance</div>
                        <div class="live-headline-value" :class="equityDelta >= 0 ? 'pnl-pos' : 'pnl-neg'">
                            {{ fmt(marginBalance) }}
                        </div>
                        <div class="live-headline-sub">
                            <span :class="equityDelta >= 0 ? 'pnl-pos' : 'pnl-neg'">
                                {{ equityDelta >= 0 ? '+' : '' }}{{ fmt(equityDelta) }}
                            </span>
                            from {{ fmt(startingBalance) }}
                            <span v-if="equityMultiple != null"> · {{ fmt(equityMultiple) }}×</span>
                        </div>
                    </div>

                    <div v-if="unrecordedResolutionCount > 0" class="live-warning">
                        ⚠ {{ unrecordedResolutionCount }} position(s) resolved off the window's last
                        candle and were never settled. The account's accounting is unreliable —
                        this should be 0.
                    </div>
                    <div v-if="accountDied" class="live-warning">
                        ⛔ ACCOUNT DEAD — balance can no longer fund the minimum position and
                        nothing is open. Not a liquidation: the account bled out through
                        ordinary stops, so no maintenance-margin close was ever triggered.
                    </div>
                    <div v-if="balanceWentNegative" class="live-warning">
                        ⛔ BALANCE NEGATIVE — the free balance (after the margin held by open
                        positions, fees, funding and closed pnl) went below zero, so the account
                        could not have carried this book. Run stopped.
                    </div>
                    <div v-if="wasLiquidated" class="live-warning">
                        ⛔ LIQUIDATED — margin balance fell to maintenance margin. Every position was
                        closed and the run stopped, as a real account would.
                    </div>
                    <div v-else-if="marginBalance <= 0" class="live-warning">
                        ⚠ Equity at or below zero.
                    </div>

                    <!-- Exposure against the DYNAMIC cap. The bar is here
                         because a number pair alone doesn't show "capped out"
                         at a glance, and being capped out is the difference
                         between "no signals fired" and "signals fired but
                         there was no room". -->
                    <div class="live-section">
                        <div class="live-row">
                            <span class="live-label" title="What a NEW position would take right now. Open positions keep whatever margin they opened with.">
                                Margin / new position
                            </span>
                            <span class="live-value">
                                {{ fmt(effectiveMargin, 2) }}
                                <span class="live-hint" v-if="useDynamicMargin">dyn</span>
                            </span>
                        </div>
                        <div class="live-row" v-if="openPositionsDisplay.length">
                            <span class="live-label" title="Committed margin divided by open positions — the book's actual average, which lags the figure above while older, smaller positions are still live.">
                                Avg margin in book
                            </span>
                            <span class="live-value">{{ fmt(estimatedMarginUsed / openPositionsDisplay.length, 2) }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Open / Cap</span>
                            <span class="live-value">{{ openPositionsDisplay.length }} / {{ maxConcurrentPositionsInput }}</span>
                        </div>
                        <div class="cap-bar" :title="`${fmtPercent(capUtilization)} of the current position cap in use`">
                            <div class="cap-bar-fill" :class="{ 'cap-full': capUtilization >= 1 }"
                                 :style="{ width: (capUtilization * 100) + '%' }"></div>
                        </div>
                        <div class="live-row" v-if="skippedSymbolTicks + analyzedSymbolTicks > 0">
                            <span class="live-label" title="Symbol-ticks that skipped the full window re-analysis because the symbol had no open position and no permission to open one. Higher is faster.">
                                Analysis skipped
                            </span>
                            <span class="live-value">
                                {{ fmtPercent(skippedSymbolTicks / (skippedSymbolTicks + analyzedSymbolTicks)) }}
                            </span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Symbols loaded</span>
                            <span class="live-value">{{ symbolsLoaded }}</span>
                        </div>
                    </div>

                    <div class="live-section">
                        <div class="live-section-title">Trades</div>
                        <div class="live-row">
                            <span class="live-label">Won</span>
                            <span class="live-value pnl-pos">{{ stats.won }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Loss</span>
                            <span class="live-value pnl-neg">{{ stats.loss }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Win rate</span>
                            <span class="live-value">{{ fmtPercent(liveWinRate) }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label" title="The candle-life cap closed these, not the strategy. Counted inside Won/Loss above, not in addition to them.">
                                Expired <span class="live-hint">(subset)</span>
                            </span>
                            <span class="live-value">{{ stats.expired }} / {{ stats.won + stats.loss }}</span>
                        </div>
                    </div>

                    <div class="live-section">
                        <div class="live-section-title">PNL</div>
                        <div class="live-row">
                            <span class="live-label">Closed</span>
                            <span class="live-value" :class="stats.totalClosedPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">{{ fmt(stats.totalClosedPnl) }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Open</span>
                            <span class="live-value" :class="stats.totalOpenPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">{{ fmt(stats.totalOpenPnl) }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Taker fees <span class="live-hint">(round trip)</span></span>
                            <span class="live-value pnl-neg">−{{ fmt(stats.totalTakerFee) }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label" title="Charged on notional every 8h (4h on some symbols), from each symbol's real funding history. Positive = paid out.">
                                Funding
                            </span>
                            <span class="live-value" :class="stats.totalFundingPaid > 0 ? 'pnl-neg' : 'pnl-pos'">
                                {{ stats.totalFundingPaid > 0 ? '−' : '+' }}{{ fmt(Math.abs(stats.totalFundingPaid)) }}
                            </span>
                        </div>
                    </div>

                    <div class="live-section">
                        <div class="live-section-title">Capital</div>
                        <div class="live-row">
                            <span class="live-label">Free balance</span>
                            <span class="live-value" :class="balance < 0 ? 'pnl-neg' : ''">{{ fmt(balance) }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Margin used</span>
                            <span class="live-value">{{ fmt(estimatedMarginUsed) }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Maintenance margin</span>
                            <span class="live-value">{{ fmt(estimatedMaintenanceMargin) }}</span>
                        </div>
                        <div class="live-row">
                            <span class="live-label">Starting balance</span>
                            <span class="live-value live-muted">{{ fmt(startingBalance) }}</span>
                        </div>
                    </div>

                    <div class="live-foot hint">All figures USDT.</div>
                </div>
            </div>

            <div class="col-lg-9 col-md-9 replay-snap-wrapper pa-md">
                <TabComponent v-model="selectedTab">
                    <TabListComponent>
                        <TabTriggerComponent v-model="selectedTab" :value="'Dashboard'">Dashboard</TabTriggerComponent>
                        <TabTriggerComponent v-model="selectedTab" :value="'Account'">Account Balance</TabTriggerComponent>
                        <TabTriggerComponent v-model="selectedTab" :value="'OpenPositions'">Open Symbols</TabTriggerComponent>
                        <TabTriggerComponent v-model="selectedTab" :value="'Settings'">Settings</TabTriggerComponent>
                    </TabListComponent>


                    <TabContentComponent v-model="selectedTab" :value="'Dashboard'">
                        <div class="dash table-scroll">
                            <div class="dash-bar">
                                <ButtonComponent color="ghost" @click="refreshDashboard">refresh</ButtonComponent>
                                <span class="hint" v-if="dashboardSummary">
                                    computed {{ fmtTime(dashboardSummary.computedAt) }}
                                    <strong v-if="dashboardSummary.partial" class="review-tag">· PARTIAL RUN</strong>
                                </span>
                            </div>

                            <div v-if="!dashboardSummary || !dashboardSummary.ticks" class="hint pa-md">
                                Nothing recorded yet — run a simulation, then refresh.
                            </div>

                            <template v-else>
                                <!-- The one line that matters most: equity hit zero, so
                                     everything after it is hypothetical. Stated at the top
                                     rather than left to be inferred from a table. -->
                                <div v-if="dashboardSummary.equityWentNonPositive" class="dash-alert">
                                    ⚠ Equity reached zero or below at {{ fmtTime(dashboardSummary.firstNonPositiveTimestamp) }}.
                                    In a real account this is liquidation — every figure after that point is hypothetical.
                                </div>

                                <div class="kpi-row">
                                    <div class="kpi">
                                        <div class="kpi-label">Net PNL</div>
                                        <div class="kpi-value" :class="dashboardSummary.netPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">
                                            {{ fmt(dashboardSummary.netPnl) }}
                                        </div>
                                        <div class="kpi-sub">
                                            {{ fmt(dashboardSummary.startingBalance) }} → {{ fmt(dashboardSummary.finalEquity) }}
                                            ({{ fmt(dashboardSummary.returnMultiple) }}×)
                                        </div>
                                    </div>
                                    <div class="kpi">
                                        <div class="kpi-label">Max Drawdown</div>
                                        <div class="kpi-value pnl-neg">{{ fmtPercent(dashboardSummary.maxDrawdownPercent) }}</div>
                                        <div class="kpi-sub">{{ fmt(dashboardSummary.maxDrawdownUsdt) }} USDT peak-to-trough</div>
                                    </div>
                                    <div class="kpi">
                                        <div class="kpi-label">Win Rate</div>
                                        <div class="kpi-value">{{ fmtPercent(dashboardSummary.winRate) }}</div>
                                        <div class="kpi-sub">{{ dashboardSummary.wins }}W / {{ dashboardSummary.losses }}L of {{ dashboardSummary.tradesClosed }}</div>
                                    </div>
                                    <div class="kpi">
                                        <div class="kpi-label">Payoff Ratio</div>
                                        <div class="kpi-value">{{ fmt(dashboardSummary.payoffRatio) }}</div>
                                        <div class="kpi-sub">avg win {{ fmt(dashboardSummary.avgWin) }} / avg loss {{ fmt(dashboardSummary.avgLoss) }}</div>
                                    </div>
                                    <div class="kpi">
                                        <div class="kpi-label">Per Trade</div>
                                        <div class="kpi-value" :class="(dashboardSummary.expectancyPerTrade ?? 0) >= 0 ? 'pnl-pos' : 'pnl-neg'">
                                            {{ fmt(dashboardSummary.expectancyPerTrade) }}
                                        </div>
                                        <div class="kpi-sub">mean realized PNL per closed trade</div>
                                    </div>
                                    <div class="kpi">
                                        <div class="kpi-label">Fees</div>
                                        <div class="kpi-value">{{ fmt(dashboardSummary.totalFees) }}</div>
                                        <div class="kpi-sub">gross +{{ fmt(dashboardSummary.grossProfit) }} / {{ fmt(dashboardSummary.grossLoss) }}</div>
                                    </div>
                                    <div class="kpi">
                                        <div class="kpi-label">Exposure</div>
                                        <div class="kpi-value">{{ dashboardSummary.maxOpenPositions }}</div>
                                        <div class="kpi-sub">max open · avg {{ fmt(dashboardSummary.avgOpenPositions, 1) }}</div>
                                    </div>
                                    <div class="kpi">
                                        <div class="kpi-label">Span</div>
                                        <div class="kpi-value">{{ dashboardSummary.ticks }}</div>
                                        <div class="kpi-sub">ticks · {{ fmtTime(dashboardSummary.firstTimestamp) }} → {{ fmtTime(dashboardSummary.lastTimestamp) }}</div>
                                    </div>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">Equity curve (margin balance)</h4>
                                    <svg class="equity-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
                                        <line v-if="breakEvenY != null" x1="0" :y1="breakEvenY" x2="100" :y2="breakEvenY"
                                              class="equity-breakeven" vector-effect="non-scaling-stroke" />
                                        <polyline :points="equityPolyline" class="equity-line" vector-effect="non-scaling-stroke" />
                                    </svg>
                                    <div class="hint">
                                        Peak {{ fmt(dashboardSummary.peakEquity) }} at {{ fmtTime(dashboardSummary.peakEquityTimestamp) }} ·
                                        Low {{ fmt(dashboardSummary.lowestEquity) }} at {{ fmtTime(dashboardSummary.lowestEquityTimestamp) }}.
                                        Dashed line is the starting balance. Downsampled keeping each bucket's high and low,
                                        so spikes are real, not smoothed away.
                                    </div>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">Costs</h4>
                                    <div class="kpi-row">
                                        <div class="kpi">
                                            <div class="kpi-label">Entry fees</div>
                                            <div class="kpi-value pnl-neg">−{{ fmt(dashboardSummary.totalEntryFees) }}</div>
                                            <div class="kpi-sub">taker, on entry notional</div>
                                        </div>
                                        <div class="kpi">
                                            <div class="kpi-label">Exit fees</div>
                                            <div class="kpi-value pnl-neg">−{{ fmt(dashboardSummary.totalExitFees) }}</div>
                                            <div class="kpi-sub">
                                                taker, on exit notional ·
                                                {{ dashboardSummary.exitFeeSampled }}/{{ dashboardSummary.tradesClosed }} priced
                                            </div>
                                        </div>
                                        <div class="kpi">
                                            <div class="kpi-label">Funding</div>
                                            <div class="kpi-value" :class="stats.totalFundingPaid > 0 ? 'pnl-neg' : 'pnl-pos'">
                                                {{ stats.totalFundingPaid > 0 ? '−' : '+' }}{{ fmt(Math.abs(stats.totalFundingPaid)) }}
                                            </div>
                                            <div class="kpi-sub">{{ fundingChargeLog.length }} settlements charged</div>
                                        </div>
                                        <div class="kpi">
                                            <div class="kpi-label">Total cost</div>
                                            <div class="kpi-value pnl-neg">−{{ fmt(dashboardSummary.totalFees + dashboardSummary.totalFunding) }}</div>
                                            <div class="kpi-sub">fees + funding, vs gross +{{ fmt(dashboardSummary.grossProfit) }}</div>
                                        </div>
                                        <div class="kpi">
                                            <div class="kpi-label">Net PNL after costs</div>
                                            <div class="kpi-value" :class="dashboardSummary.netTotalPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">
                                                {{ fmt(dashboardSummary.netTotalPnl) }}
                                            </div>
                                            <div class="kpi-sub">
                                                gross {{ fmt(dashboardSummary.grossProfit + dashboardSummary.grossLoss) }}
                                                · {{ fmt(dashboardSummary.netExpectancyPerTrade) }}/trade
                                            </div>
                                        </div>
                                        <div class="kpi">
                                            <div class="kpi-label">Funding coverage</div>
                                            <div class="kpi-value">{{ symbolsLoaded - fundingSymbolsMissing.length }}/{{ symbolsLoaded }}</div>
                                            <div class="kpi-sub">symbols with real rate history</div>
                                        </div>
                                    </div>
                                    <div class="hint" v-if="fundingSymbolsMissing.length">
                                        ⚠ {{ fundingSymbolsMissing.length }} symbol(s) had no funding history and were charged
                                        <strong>zero</strong> funding — that is a gap in the data, not free carry:
                                        {{ fundingSymbolsMissing.slice(0, 12).join(', ') }}{{ fundingSymbolsMissing.length > 12 ? '…' : '' }}
                                    </div>
                                    <div class="hint" v-if="dashboardSummary.grossWinnersLostToCosts > 0">
                                        <strong>{{ dashboardSummary.grossWinnersLostToCosts }}</strong> of
                                        {{ dashboardSummary.wins }} gross winners were turned into net losers by costs.
                                        Every <code>pnl</code> figure elsewhere on this dashboard is
                                        <strong>gross</strong> — price movement only, before fees and funding.
                                    </div>
                                    <div class="hint">
                                        Funding is charged on <strong>notional</strong>, not margin — at
                                        {{ fmt(marginInput, 0) }}× leverage that is {{ fmt(marginInput, 0) }} times larger
                                        than a margin-based estimate. Rates are each symbol's real settlements, so a
                                        crowded long in an uptrend pays far more than the 0.01% baseline.
                                    </div>
                                </div>

                                <div v-if="wasLiquidated" class="dash-alert">
                                    ⛔ <strong>LIQUIDATED</strong> at
                                    {{ fmtTime(liquidationEvents[liquidationEvents.length - 1]?.timestamp) }} —
                                    margin balance ({{ fmt(liquidationEvents[liquidationEvents.length - 1]?.marginBalance) }})
                                    fell to maintenance margin
                                    ({{ fmt(liquidationEvents[liquidationEvents.length - 1]?.maintenanceMargin) }}).
                                    {{ liquidationEvents[liquidationEvents.length - 1]?.positionsClosed }} positions were
                                    force-closed and the run ended here. A real liquidation also charges a liquidation fee
                                    and fills into a falling book, so this is the optimistic end of the outcome.
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">How positions ended</h4>
                                    <table class="dash-table">
                                        <thead><tr><th>Reason</th><th>Count</th><th>Share</th><th>Gross PNL</th><th>Cost</th><th>Net PNL</th><th>Avg PNL</th><th>W/L</th></tr></thead>
                                        <tbody>
                                            <tr v-for="row in dashboardSummary.exitBreakdown" :key="row.reason">
                                                <td>{{ row.reason }}</td>
                                                <td>{{ row.count }}</td>
                                                <td>{{ fmtPercent(row.share) }}</td>
                                                <td :class="row.totalPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">{{ fmt(row.totalPnl) }}</td>
                                                <td class="pnl-neg">−{{ fmt(row.totalCost) }}</td>
                                                <td :class="row.netPnl >= 0 ? 'pnl-pos' : 'pnl-neg'"><strong>{{ fmt(row.netPnl) }}</strong></td>
                                                <td :class="row.avgPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">{{ fmt(row.avgPnl) }}</td>
                                                <td>{{ row.wins }}/{{ row.losses }}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    <div class="hint">
                                        Net = gross minus that bucket's own entry fee, exit fee and funding. A bucket
                                        can be gross-positive and net-negative — EXPIRED most easily, since it carries
                                        the longest holds and therefore the most funding settlements.
                                        EXPIRED = the candle-life cap closed it, not the strategy. A WON there only means
                                        it was above water when the cap gave up, NOT that take-profit was reached.
                                        UNKNOWN = a record from before close reasons were tracked.
                                    </div>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">Biggest drawdowns</h4>
                                    <table class="dash-table">
                                        <thead><tr><th>Peak</th><th>Trough</th><th>Depth</th><th>Depth %</th><th>Ticks down</th><th>Recovered</th></tr></thead>
                                        <tbody>
                                            <tr v-for="(dd, i) in dashboardSummary.topDrawdowns" :key="i">
                                                <td>{{ fmtTime(dd.peakTimestamp) }} <span class="hint">({{ fmt(dd.peakEquity) }})</span></td>
                                                <td>{{ fmtTime(dd.troughTimestamp) }} <span class="hint">({{ fmt(dd.troughEquity) }})</span></td>
                                                <td class="pnl-neg">{{ fmt(dd.depthUsdt) }}</td>
                                                <td class="pnl-neg">{{ fmtPercent(dd.depthPercent) }}</td>
                                                <td>{{ dd.ticksToTrough }}</td>
                                                <td>
                                                    <span v-if="dd.recoveredTimestamp">{{ fmtTime(dd.recoveredTimestamp) }}</span>
                                                    <strong v-else class="pnl-neg">never</strong>
                                                    <span v-if="dd.wentNonPositive" class="pnl-neg"> · hit zero</span>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    <div class="hint">
                                        Sorted by PERCENT depth, not USDT — on a compounding account the USDT figure grows
                                        with the balance, so it would just rank the latest drawdowns. "Never recovered" is
                                        the row that matters most.
                                    </div>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">Biggest single-tick moves</h4>
                                    <div class="dash-split">
                                        <div>
                                            <div class="hint">Worst</div>
                                            <table class="dash-table">
                                                <thead><tr><th>Time</th><th>Change</th><th>Open</th><th>Closed</th></tr></thead>
                                                <tbody>
                                                    <tr v-for="(m, i) in dashboardSummary.worstTicks" :key="'w'+i">
                                                        <td>{{ fmtTime(m.timestamp) }}</td>
                                                        <td class="pnl-neg">{{ fmt(m.changeUsdt) }}</td>
                                                        <td>{{ m.openBefore }} → {{ m.openAfter }}</td>
                                                        <td>{{ m.closedThisTick }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                        <div>
                                            <div class="hint">Best</div>
                                            <table class="dash-table">
                                                <thead><tr><th>Time</th><th>Change</th><th>Open</th><th>Closed</th></tr></thead>
                                                <tbody>
                                                    <tr v-for="(m, i) in dashboardSummary.bestTicks" :key="'b'+i">
                                                        <td>{{ fmtTime(m.timestamp) }}</td>
                                                        <td class="pnl-pos">{{ fmt(m.changeUsdt) }}</td>
                                                        <td>{{ m.openBefore }} → {{ m.openAfter }}</td>
                                                        <td>{{ m.closedThisTick }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div class="hint">
                                        A large drop with a large "Closed" count on the same tick is the correlated
                                        mass-close pattern — many positions stopping out together, not one bad trade.
                                    </div>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">Biggest earnings and losses (individual trades)</h4>
                                    <div class="dash-split">
                                        <div>
                                            <div class="hint">Top earners</div>
                                            <table class="dash-table">
                                                <thead><tr><th>Symbol</th><th>Side</th><th>Opened</th><th>Gross</th><th>Cost</th><th>Net</th><th>Exit</th></tr></thead>
                                                <tbody>
                                                    <tr v-for="(t, i) in dashboardSummary.topWinningTrades" :key="'tw'+i">
                                                        <td><button class="link-btn" @click="inspectSymbolChart(t.symbol)">{{ t.symbol }}</button></td>
                                                        <td>{{ t.side }}</td>
                                                        <td>{{ fmtTime(t.openTime) }}</td>
                                                        <td class="pnl-pos">{{ fmt(t.pnl) }}</td>
                                                        <td class="pnl-neg">−{{ fmt((t.entryFee ?? 0) + (t.exitFee ?? 0) + (t.fundingPaid ?? 0)) }}</td>
                                                        <td :class="((t.pnl ?? 0) - ((t.entryFee ?? 0) + (t.exitFee ?? 0) + (t.fundingPaid ?? 0))) >= 0 ? 'pnl-pos' : 'pnl-neg'">
                                                            <strong>{{ fmt((t.pnl ?? 0) - ((t.entryFee ?? 0) + (t.exitFee ?? 0) + (t.fundingPaid ?? 0))) }}</strong>
                                                        </td>
                                                        <td>{{ t.closeReason ?? '—' }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                        <div>
                                            <div class="hint">Worst losers</div>
                                            <table class="dash-table">
                                                <thead><tr><th>Symbol</th><th>Side</th><th>Opened</th><th>Gross</th><th>Cost</th><th>Net</th><th>Exit</th></tr></thead>
                                                <tbody>
                                                    <tr v-for="(t, i) in dashboardSummary.topLosingTrades" :key="'tl'+i">
                                                        <td><button class="link-btn" @click="inspectSymbolChart(t.symbol)">{{ t.symbol }}</button></td>
                                                        <td>{{ t.side }}</td>
                                                        <td>{{ fmtTime(t.openTime) }}</td>
                                                        <td class="pnl-neg">{{ fmt(t.pnl) }}</td>
                                                        <td class="pnl-neg">−{{ fmt((t.entryFee ?? 0) + (t.exitFee ?? 0) + (t.fundingPaid ?? 0)) }}</td>
                                                        <td :class="((t.pnl ?? 0) - ((t.entryFee ?? 0) + (t.exitFee ?? 0) + (t.fundingPaid ?? 0))) >= 0 ? 'pnl-pos' : 'pnl-neg'">
                                                            <strong>{{ fmt((t.pnl ?? 0) - ((t.entryFee ?? 0) + (t.exitFee ?? 0) + (t.fundingPaid ?? 0))) }}</strong>
                                                        </td>
                                                        <td>{{ t.closeReason ?? '—' }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div class="hint">Click a symbol to open its chart from the simulation's current window.</div>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">Excursions — how far each trade travelled (ATR from entry)</h4>
                                    <div v-if="!dashboardSummary.excursions.sampled" class="hint">
                                        Not captured in this run — MAE/MFE were computed but discarded before they
                                        reached the result. Only runs recorded after that fix carry them.
                                    </div>
                                    <template v-else>
                                        <div class="excursion-layout">
                                            <div class="excursion-chart-wrap">
                                                <svg :viewBox="`0 0 ${SCATTER.w} ${SCATTER.h}`" class="excursion-chart" v-if="scatterGeometry">
                                                    <!-- gridlines -->
                                                    <line v-for="t in scatterGeometry.xTicks" :key="'gx'+t.label"
                                                          :x1="t.x" :y1="scatterGeometry.plotTop" :x2="t.x" :y2="scatterGeometry.axisY"
                                                          class="ex-grid" />
                                                    <line v-for="t in scatterGeometry.yTicks" :key="'gy'+t.label"
                                                          :x1="scatterGeometry.axisX" :y1="t.y" :x2="scatterGeometry.plotRight" :y2="t.y"
                                                          class="ex-grid" />
                                                    <!-- MFE = MAE reference -->
                                                    <line :x1="scatterGeometry.diag.x1" :y1="scatterGeometry.diag.y1"
                                                          :x2="scatterGeometry.diag.x2" :y2="scatterGeometry.diag.y2"
                                                          class="ex-diag" />
                                                    <!-- losers first so winners aren't buried under them -->
                                                    <circle v-for="(pt, i) in scatterGeometry.points.filter(p => !p.won)" :key="'l'+i"
                                                            :cx="pt.cx" :cy="pt.cy" r="2" class="ex-dot ex-loss" />
                                                    <circle v-for="(pt, i) in scatterGeometry.points.filter(p => p.won)" :key="'w'+i"
                                                            :cx="pt.cx" :cy="pt.cy" r="2" class="ex-dot ex-win" />
                                                    <!-- axes -->
                                                    <line :x1="scatterGeometry.axisX" :y1="scatterGeometry.axisY"
                                                          :x2="scatterGeometry.plotRight" :y2="scatterGeometry.axisY" class="ex-axis" />
                                                    <line :x1="scatterGeometry.axisX" :y1="scatterGeometry.plotTop"
                                                          :x2="scatterGeometry.axisX" :y2="scatterGeometry.axisY" class="ex-axis" />
                                                    <text v-for="t in scatterGeometry.xTicks" :key="'tx'+t.label"
                                                          :x="t.x" :y="scatterGeometry.axisY + 12" class="ex-tick" text-anchor="middle">{{ t.label }}</text>
                                                    <text v-for="t in scatterGeometry.yTicks" :key="'ty'+t.label"
                                                          :x="scatterGeometry.axisX - 5" :y="t.y + 3" class="ex-tick" text-anchor="end">{{ t.label }}</text>
                                                    <text :x="(scatterGeometry.axisX + scatterGeometry.plotRight) / 2" :y="SCATTER.h - 4"
                                                          class="ex-axis-label" text-anchor="middle">MAE — how far it went against you</text>
                                                    <text :x="10" :y="SCATTER.h / 2" class="ex-axis-label" text-anchor="middle"
                                                          :transform="`rotate(-90 10 ${SCATTER.h / 2})`">MFE — in your favour</text>
                                                </svg>
                                                <div class="ex-legend">
                                                    <span><i class="ex-swatch ex-win-bg"></i> winners</span>
                                                    <span><i class="ex-swatch ex-loss-bg"></i> losers</span>
                                                    <span><i class="ex-swatch ex-diag-bg"></i> MFE = MAE</span>
                                                    <span class="hint">
                                                        showing {{ dashboardSummary.excursions.scatterSampled }}
                                                        of {{ dashboardSummary.excursions.sampled }}
                                                    </span>
                                                </div>
                                            </div>

                                            <div class="excursion-side">
                                                <table class="dash-table">
                                                    <thead><tr><th></th><th>Avg MAE</th><th>Avg MFE</th></tr></thead>
                                                    <tbody>
                                                        <tr><td>All</td><td class="pnl-neg">{{ fmt(dashboardSummary.excursions.avgMae) }}</td><td class="pnl-pos">{{ fmt(dashboardSummary.excursions.avgMfe) }}</td></tr>
                                                        <tr><td>Winners</td><td class="pnl-neg">{{ fmt(dashboardSummary.excursions.avgMaeWinners) }}</td><td class="pnl-pos">{{ fmt(dashboardSummary.excursions.avgMfeWinners) }}</td></tr>
                                                        <tr><td>Losers</td><td class="pnl-neg">{{ fmt(dashboardSummary.excursions.avgMaeLosers) }}</td><td class="pnl-pos">{{ fmt(dashboardSummary.excursions.avgMfeLosers) }}</td></tr>
                                                    </tbody>
                                                </table>

                                                <table class="dash-table mt-sm">
                                                    <thead><tr><th></th><th>p50</th><th>p75</th><th>p90</th><th>max</th></tr></thead>
                                                    <tbody>
                                                        <tr>
                                                            <td title="How much of the stop's room winning trades actually used">Winner MAE</td>
                                                            <td>{{ fmt(dashboardSummary.excursions.winnerMaePercentiles.p50) }}</td>
                                                            <td>{{ fmt(dashboardSummary.excursions.winnerMaePercentiles.p75) }}</td>
                                                            <td>{{ fmt(dashboardSummary.excursions.winnerMaePercentiles.p90) }}</td>
                                                            <td>{{ fmt(dashboardSummary.excursions.winnerMaePercentiles.max) }}</td>
                                                        </tr>
                                                        <tr>
                                                            <td title="How close losing trades came to the target before turning">Loser MFE</td>
                                                            <td>{{ fmt(dashboardSummary.excursions.loserMfePercentiles.p50) }}</td>
                                                            <td>{{ fmt(dashboardSummary.excursions.loserMfePercentiles.p75) }}</td>
                                                            <td>{{ fmt(dashboardSummary.excursions.loserMfePercentiles.p90) }}</td>
                                                            <td>{{ fmt(dashboardSummary.excursions.loserMfePercentiles.max) }}</td>
                                                        </tr>
                                                    </tbody>
                                                </table>

                                                <div class="hint mt-sm" v-if="dashboardSummary.excursions.losersThatWentFavorableFirst != null">
                                                    {{ dashboardSummary.excursions.losersThatWentFavorableFirst }} of
                                                    {{ dashboardSummary.losses }} losers went further in your favour than the
                                                    average winner ever went against you
                                                    ({{ fmt(dashboardSummary.excursions.winnerMaeReference) }} ATR).
                                                </div>
                                            </div>
                                        </div>

                                        <div class="dash-split mt-sm">
                                            <div>
                                                <div class="hint">MAE distribution — against you</div>
                                                <div class="hist">
                                                    <div v-for="b in maeBars" :key="'mae'+b.key" class="hist-col"
                                                         :title="`${b.from.toFixed(2)}–${b.to.toFixed(2)} ATR · ${b.winners} winners, ${b.losers} losers`">
                                                        <div class="hist-stack">
                                                            <div class="hist-loss" :style="{ height: b.lossPercent + '%' }"></div>
                                                            <div class="hist-win" :style="{ height: b.winPercent + '%' }"></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="hist-axis hint">
                                                    <span>0</span><span>{{ fmt(dashboardSummary.excursions.maxMae, 1) }} ATR</span>
                                                </div>
                                            </div>
                                            <div>
                                                <div class="hint">MFE distribution — in your favour</div>
                                                <div class="hist">
                                                    <div v-for="b in mfeBars" :key="'mfe'+b.key" class="hist-col"
                                                         :title="`${b.from.toFixed(2)}–${b.to.toFixed(2)} ATR · ${b.winners} winners, ${b.losers} losers`">
                                                        <div class="hist-stack">
                                                            <div class="hist-loss" :style="{ height: b.lossPercent + '%' }"></div>
                                                            <div class="hist-win" :style="{ height: b.winPercent + '%' }"></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="hist-axis hint">
                                                    <span>0</span><span>{{ fmt(dashboardSummary.excursions.maxMfe, 1) }} ATR</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="hint mt-sm">
                                            <strong>Read these as censored distributions.</strong> A trade whose adverse move
                                            would have passed the stop was stopped out and recorded as a loss, so winners' MAE
                                            cannot run much past the stop distance — you will see that as a wall on the right of
                                            the green cloud. Symmetrically, a trade whose favourable move passed the target hit
                                            it and became a win, capping losers' MFE. Neither tail is missing at random; the exit
                                            rule removed it. So these say how much of the available room each side actually uses,
                                            and where mass piles against the boundary — winners bunched at low MAE means the stop
                                            is wider than winners need. They cannot tell you how many winners a wider stop would
                                            have saved: those trades sit in the loss bucket, indistinguishable from trades that
                                            were simply wrong.
                                        </div>
                                    </template>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">Position sizing over the run</h4>
                                    <div class="hint" v-if="!dashboardSummary.marginProgression.marginChanged">
                                        Sizing never changed — every trade used margin
                                        {{ fmt(dashboardSummary.marginProgression.tiers[0]?.margin, 2) }}.
                                        Enable dynamic margin in Settings to let it scale with balance.
                                    </div>
                                    <template v-else>
                                        <div class="hint">
                                            Margin for a new position went
                                            {{ fmt(dashboardSummary.marginProgression.firstTickMargin, 2) }}
                                            → {{ fmt(dashboardSummary.marginProgression.lastTickMargin, 2) }}
                                            (range {{ fmt(dashboardSummary.marginProgression.minTickMargin, 2) }}–{{ fmt(dashboardSummary.marginProgression.maxTickMargin, 2) }}),
                                            across {{ dashboardSummary.marginProgression.tiers.length }} sizes actually traded.
                                        </div>
                                        <table class="dash-table">
                                            <thead><tr>
                                                <th>Margin</th><th>Trades</th><th>Win rate</th>
                                                <th>Gross</th><th>Cost</th><th>Net</th>
                                                <th>Avg net</th><th>Net per margin unit</th>
                                            </tr></thead>
                                            <tbody>
                                                <tr v-for="t in dashboardSummary.marginProgression.tiers" :key="t.margin">
                                                    <td><strong>{{ fmt(t.margin, 2) }}</strong></td>
                                                    <td>{{ t.trades }}</td>
                                                    <td>{{ fmtPercent(t.winRate) }}</td>
                                                    <td :class="t.grossPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">{{ fmt(t.grossPnl) }}</td>
                                                    <td class="pnl-neg">−{{ fmt(t.cost) }}</td>
                                                    <td :class="t.netPnl >= 0 ? 'pnl-pos' : 'pnl-neg'"><strong>{{ fmt(t.netPnl) }}</strong></td>
                                                    <td :class="t.avgNetPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">{{ fmt(t.avgNetPnl, 3) }}</td>
                                                    <td :class="(t.netPerMarginUnit ?? 0) >= 0 ? 'pnl-pos' : 'pnl-neg'">{{ fmt(t.netPerMarginUnit, 4) }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                        <div class="hint">
                                            Grouped by each position's <strong>own</strong> margin — a book holds several
                                            sizes at once, since a position keeps what it opened with while newer ones
                                            size up.
                                            <strong>Net per margin unit</strong> is the column that answers whether the
                                            edge survived being scaled: raw Net rises with size by construction, so a
                                            bigger tier always looks better until you divide it out. If that number falls
                                            as margin rises, scaling is costing something real. Read it with the trade
                                            counts — an early tier with few trades is noise, and later tiers also ran in
                                            different market conditions, so this is not a clean experiment.
                                        </div>
                                    </template>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">LONG vs SHORT</h4>
                                    <table class="dash-table">
                                        <thead><tr><th>Side</th><th>Trades</th><th>Wins</th><th>Win rate</th><th>Total PNL</th><th>Avg win</th><th>Avg loss</th></tr></thead>
                                        <tbody>
                                            <tr v-for="row in dashboardSummary.sideBreakdown" :key="row.side">
                                                <td>{{ row.side }}</td>
                                                <td>{{ row.trades }}</td>
                                                <td>{{ row.wins }}</td>
                                                <td>{{ fmtPercent(row.winRate) }}</td>
                                                <td :class="row.totalPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">{{ fmt(row.totalPnl) }}</td>
                                                <td>{{ fmt(row.avgWin) }}</td>
                                                <td>{{ fmt(row.avgLoss) }}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                <div class="dash-panel">
                                    <h4 class="settings-title">Symbols that moved the account</h4>
                                    <div class="dash-split">
                                        <div>
                                            <div class="hint">Most profitable</div>
                                            <table class="dash-table">
                                                <thead><tr><th>Symbol</th><th>Trades</th><th>W/L</th><th>Total PNL</th></tr></thead>
                                                <tbody>
                                                    <tr v-for="row in dashboardSummary.topSymbolsByProfit" :key="'sp'+row.symbol">
                                                        <td><button class="link-btn" @click="inspectSymbolChart(row.symbol)">{{ row.symbol }}</button></td>
                                                        <td>{{ row.trades }}</td>
                                                        <td>{{ row.wins }}/{{ row.losses }}</td>
                                                        <td class="pnl-pos">{{ fmt(row.totalPnl) }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                        <div>
                                            <div class="hint">Most costly</div>
                                            <table class="dash-table">
                                                <thead><tr><th>Symbol</th><th>Trades</th><th>W/L</th><th>Total PNL</th></tr></thead>
                                                <tbody>
                                                    <tr v-for="row in dashboardSummary.topSymbolsByLoss" :key="'sl'+row.symbol">
                                                        <td><button class="link-btn" @click="inspectSymbolChart(row.symbol)">{{ row.symbol }}</button></td>
                                                        <td>{{ row.trades }}</td>
                                                        <td>{{ row.wins }}/{{ row.losses }}</td>
                                                        <td class="pnl-neg">{{ fmt(row.totalPnl) }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </TabContentComponent>

                    <TabContentComponent v-model="selectedTab" :value="'Account'">
                        <div class="table-toolbar">
                            <ButtonComponent color="ghost" :disabled="snapshotsPage <= 1" @click="snapshotsPage--">prev</ButtonComponent>
                            <span class="pager-label">page {{ snapshotsPage }} / {{ totalSnapshotsPages }}</span>
                            <ButtonComponent color="ghost" :disabled="snapshotsPage >= totalSnapshotsPages" @click="snapshotsPage++">next</ButtonComponent>
                        </div>
                        <div class="table-scroll">
                            <TableComponent>
                            <template #header>
                                <TableHeaderComponent>
                                    <th>Time</th>
                                    <th>Open</th>
                                    <th>Won</th>
                                    <th>Loss</th>
                                    <th>Expired</th>
                                    <th>Entry Fee</th>
                                    <th>Exit Fee</th>
                                    <th>Funding</th>
                                    <th>Closed PNL</th>
                                    <th>Open PNL</th>
                                    <th>Margin Balance</th>
                                    <th>Balance</th>
                                    <th>Maintenance Margin</th>
                                    <th>Margin</th>
                                    <th>Cap</th>
                                </TableHeaderComponent>
                            </template>
                            <template #body>
                                <TableBodyComponent>
                                    <tr
                                        v-for="entry in pagedSnapshots"
                                        :key="entry.snapshot.timestamp"
                                        :class="{ 'cursor-row': entry.index === activeSnapshotIndex }"
                                        @click="setReviewCursor(entry.index)"
                                    >
                                        <td>{{ new Date(entry.snapshot.timestamp).toLocaleString() }}</td>
                                        <td>{{ entry.snapshot.open }}</td>
                                        <td>{{ entry.snapshot.won }}</td>
                                        <td>{{ entry.snapshot.loss }}</td>
                                        <td>{{ entry.snapshot.expired }}</td>
                                        <td class="pnl-neg">{{ fmt(entry.snapshot.totalEntryFee) }}</td>
                                        <td class="pnl-neg">{{ fmt(entry.snapshot.totalExitFee) }}</td>
                                        <td :class="entry.snapshot.totalFundingPaid > 0 ? 'pnl-neg' : 'pnl-pos'">{{ fmt(entry.snapshot.totalFundingPaid) }}</td>
                                        <td>{{ entry.snapshot.totalClosedPnl.toFixed(2) }}</td>
                                        <td>{{ entry.snapshot.totalOpenPnl.toFixed(2) }}</td>
                                        <td>{{ entry.snapshot.marginBalance.toFixed(2) }}</td>
                                        <td>{{ entry.snapshot.balance.toFixed(2) }}</td>
                                        <td>{{ entry.snapshot.estimatedMaintenanceMargin.toFixed(2) }}</td>
                                        <td>{{ fmt(entry.snapshot.marginPerPosition, 2) }}</td>
                                        <td>{{ entry.snapshot.open }}/{{ entry.snapshot.positionCap }}</td>
                                    </tr>
                                </TableBodyComponent>
                            </template>
                        </TableComponent>
                        </div>
                    </TabContentComponent>

                    <TabContentComponent v-model="selectedTab" :value="'OpenPositions'">
                        <div class="pa-sm">
                            <span v-if="activeSnapshot">
                                {{ displayedPositions.length }} open at
                                {{ new Date(activeSnapshot.timestamp).toLocaleString() }}
                            </span>
                            <span v-else>no tick recorded yet</span>
                        </div>
                        <div class="symbol-chip-grid table-scroll">
                            <button
                                v-for="row in displayedPositions"
                                :key="row.symbol + ':' + row.openTime"
                                class="symbol-chip"
                                :class="row.side === 'LONG' ? 'chip-long' : 'chip-short'"
                                :title="`${row.side} @ ${row.entryPrice} · margin ${row.margin} — opened ${new Date(row.openTime).toLocaleString()} — click to inspect the chart`"
                                @click="inspectSymbolChart(row.symbol)"
                            >
                                <span class="chip-symbol">{{ row.symbol }}</span>
                                <span class="chip-side">{{ row.side }}</span>
                                <span class="chip-pnl" :class="row.markToMarketPnl >= 0 ? 'pnl-pos' : 'pnl-neg'">
                                    {{ row.markToMarketPnl.toFixed(2) }}
                                </span>
                            </button>
                        </div>
                        <div class="pa-sm hint" v-if="!displayedPositions.length">
                            Nothing open at this tick.
                        </div>
                    </TabContentComponent>

                    <TabContentComponent v-model="selectedTab" :value="'Settings'">
                        <div class="settings-pane table-scroll">
                            <div class="settings-group settings-wide preset-bar">
                                <h4 class="settings-title">Preset</h4>
                                <div class="preset-row">
                                    <select v-model="selectedPresetName" :disabled="isRunning" class="preset-select">
                                        <option value="">— pick a preset —</option>
                                        <optgroup label="Built in">
                                            <option v-for="p in BUILT_IN_PRESETS" :key="p.name" :value="p.name">{{ p.name }}</option>
                                        </optgroup>
                                        <optgroup label="Saved" v-if="userPresets.length">
                                            <option v-for="p in userPresets" :key="p.name" :value="p.name">{{ p.name }}</option>
                                        </optgroup>
                                    </select>
                                    <button type="button" class="preset-btn" :disabled="isRunning || !selectedPreset" @click="applySelectedPreset">apply</button>
                                    <button type="button" class="preset-btn preset-danger" :disabled="isRunning || !selectedPreset || selectedPreset.builtIn" @click="deleteSelectedPreset">delete</button>
                                </div>
                                <div class="preset-row">
                                    <input v-model="newPresetName" :disabled="isRunning" class="preset-select" type="text" placeholder="name for the current settings" />
                                    <button type="button" class="preset-btn" :disabled="isRunning || !newPresetName.trim()" @click="saveCurrentAsPreset">save as preset</button>
                                </div>
                                <div class="settings-field hint" v-if="selectedPreset">{{ selectedPreset.description }}</div>
                                <div class="settings-field hint preset-drift" v-if="selectedPreset && presetDrift.length">
                                    modified from "{{ selectedPreset.name }}" in {{ presetDrift.length }} setting(s):
                                    {{ presetDrift.join(', ') }} — this run is no longer that configuration.
                                </div>
                                <div class="settings-field hint" v-else-if="selectedPreset">
                                    settings match "{{ selectedPreset.name }}" exactly.
                                </div>
                                <div class="settings-field hint" v-if="presetMessage">{{ presetMessage }}</div>
                                <div class="settings-field hint" v-if="presetLoadNote">{{ presetLoadNote }}</div>
                                <details class="settings-field hint settings-why">
                                    <summary>why</summary>
                                    A preset is the WHOLE configuration or nothing — all
                                    {{ SETTING_KEYS.length }} settings, including the date range, because
                                    the same settings over a different window are not the same
                                    experiment. Comparing two runs otherwise means setting thirty-odd
                                    fields by hand, and one missed field makes the runs incomparable in
                                    a way that looks exactly like a result. Auto-close rules are NOT
                                    carried: they are a list with their own editor, and a preset that
                                    silently deleted them would be worse than one that ignores them.
                                </details>
                            </div>
                            <div class="settings-group">
                                <h4 class="settings-title">Run</h4>
                                <label class="settings-field">start date/time
                                    <input type="datetime-local" v-model="startDateTimeInput" :disabled="isRunning" class="datetime-input" />
                                </label>
                                <label class="settings-field">end date/time (optional)
                                    <input type="datetime-local" v-model="endDateTimeInput" :disabled="isRunning" class="datetime-input" />
                                </label>
                                <details class="settings-field hint settings-why">
                                    <summary>why</summary>
                                    Empty walks until the run catches up to now. Set it and the run is
                                    bounded to a fixed range — which is what makes two runs comparable
                                    after a code change. An open-ended run stops somewhere different
                                    every day, so it can never be a baseline.
                                </details>
                                <div class="settings-field hint" v-if="archiveError">
                                    archive disabled: {{ archiveError }} — the run continues, but
                                    "download full data" will be incomplete.
                                </div>
                            </div>

                            <div class="settings-group">
                                <h4 class="settings-title">Account</h4>
                                <label class="settings-field">starting balance
                                    <InputComponent v-model.number="startingBalance" :disabled="isRunning" />
                                </label>
                                <label class="settings-field">margin per position
                                    <InputComponent v-model.number="marginInput" :disabled="isRunning || useDynamicMargin" />
                                </label>
                                <label class="settings-field settings-check">
                                    <input type="checkbox" v-model="useDynamicMargin" :disabled="isRunning" />
                                    dynamic margin (scale with balance)
                                </label>
                                <template v-if="useDynamicMargin">
                                    <label class="settings-field">every +balance of
                                        <InputComponent v-model.number="marginStepBalance" :disabled="isRunning" />
                                    </label>
                                    <label class="settings-field">add to margin
                                        <InputComponent v-model.number="marginStepAmount" :disabled="isRunning" />
                                    </label>
                                    <label class="settings-field">margin floor
                                        <InputComponent v-model.number="marginFloorInput" :disabled="isRunning" />
                                    </label>
                                    <label class="settings-field">margin ceiling
                                        <InputComponent v-model.number="marginCeilingInput" :disabled="isRunning" />
                                    </label>
                                    <div class="settings-field hint">
                                        margin = clamp(floor(balance ÷ {{ marginStepBalance }}) × {{ marginStepAmount }},
                                        {{ marginFloorInput }}, {{ marginCeilingInput }})<br />
                                        at the current balance that is <strong>{{ fmt(effectiveMargin, 2) }}</strong>.
                                    </div>
                                    <div class="settings-field hint">
                                        ⚠ The position cap is balance × ratio ÷ margin. With margin also scaling on
                                        balance, that ratio stays near {{ fmt(marginStepBalance / marginStepAmount, 0) }},
                                        so the cap pins at roughly
                                        <strong>{{ Math.round(positionCapRatioInput * marginStepBalance / marginStepAmount) }}</strong>
                                        positions instead of growing. Same total exposure, held as fewer and bigger
                                        positions — more concentrated, not less risky.
                                    </div>
                                </template>
                            </div>

                            <div class="settings-group">
                                <h4 class="settings-title">Position</h4>

                                <label class="settings-field">symbols initialized in parallel
                                    <InputComponent v-model.number="initConcurrencyInput" :disabled="isRunning" />
                                </label>
                                <details class="settings-field hint settings-why">
                                    <summary>why</summary>
                                    Overlaps the two REST calls per symbol during warm-up. It does not
                                    parallelize the analysis — that is one thread either way — so the
                                    ceiling is total CPU time. Binance allows 2,400 request weight per
                                    minute per IP and a full init costs roughly 1,000, so 6 sits well
                                    inside it; going high enough to trip the limit earns a 418 IP ban.
                                    Results are committed in roster order regardless of which symbol
                                    finishes first, so runs stay reproducible. 1 = sequential.
                                </details>
                                <label class="settings-field">symbols per yield
                                    <InputComponent v-model.number="yieldEverySymbols" :disabled="isRunning" />
                                </label>
                                <details class="settings-field hint settings-why">
                                    <summary>why</summary>
                                    Higher = fewer pauses handed back to the browser, so slightly faster
                                    but a less responsive tab. Worth minutes over a full run, not hours.
                                </details>

                                <label class="settings-field">position candle life
                                    <InputComponent v-model.number="maxPositionDurationInput" :disabled="isRunning" />
                                </label>

                            </div>

                            <div class="settings-group">
                                <h4 class="settings-title">Position cap</h4>
                                <label class="settings-field">cap ratio
                                    <InputComponent v-model.number="positionCapRatioInput" :disabled="isRunning" />
                                </label>
                                <label class="settings-field">cap floor
                                    <InputComponent v-model.number="positionCapFloorInput" :disabled="isRunning" />
                                </label>
                                <label class="settings-field">cap ceiling
                                    <InputComponent v-model.number="positionCapCeilingInput" :disabled="isRunning" />
                                </label>
                                <div class="settings-field hint">
                                    current cap: <strong>{{ maxConcurrentPositionsInput }}</strong>
                                    — clamp(balance × ratio ÷ margin, floor, ceiling)
                                </div>
                            </div>

                            <div class="settings-group settings-wide">
                                <h4 class="settings-title">
                                    Auto-close rules
                                    <ButtonComponent color="ghost" @click="addAutoCloseRule" :disabled="isRunning">+ add rule</ButtonComponent>
                                </h4>
                                <p class="hint">
                                    Every enabled rule is checked on every tick and ANY of them firing
                                    closes EVERY open position across every symbol. Rules are OR'd, not
                                    prioritized. No rules = the position candle life is the only early exit.
                                </p>
                                <div v-if="!autoCloseRules.length" class="hint pa-sm">No auto-close rules.</div>
                                <div v-for="rule in autoCloseRules" :key="rule.id" class="rule-row">
                                    <input type="checkbox" v-model="rule.enabled" :disabled="isRunning" title="enable this rule" />
                                    <select v-model="rule.type" :disabled="isRunning" class="datetime-input">
                                        <option v-for="(label, type) in AUTO_CLOSE_RULE_LABELS" :key="type" :value="type">{{ label }}</option>
                                    </select>

                                    <template v-if="rule.type === 'DAILY_TIME'">
                                        <InputComponent v-model.number="rule.dailyHour" :disabled="isRunning" style="width: 3.5em; display: inline-block;" />
                                        :
                                        <InputComponent v-model.number="rule.dailyMinute" :disabled="isRunning" style="width: 3.5em; display: inline-block;" />
                                        <select v-model="rule.dailyAmPm" :disabled="isRunning" class="datetime-input">
                                            <option value="AM">AM</option>
                                            <option value="PM">PM</option>
                                        </select>
                                    </template>
                                    <template v-else-if="rule.type === 'EVERY_N_DAYS'">
                                        <InputComponent v-model.number="rule.everyNDays" :disabled="isRunning" style="width: 4.5em; display: inline-block;" />
                                        <span class="hint">day(s)</span>
                                    </template>
                                    <template v-else-if="rule.type === 'EVERY_N_HOURS'">
                                        <InputComponent v-model.number="rule.everyNHours" :disabled="isRunning" style="width: 4.5em; display: inline-block;" />
                                        <span class="hint">hour(s)</span>
                                    </template>
                                    <template v-else>
                                        <InputComponent v-model.number="rule.pnlThreshold" :disabled="isRunning" style="width: 6em; display: inline-block;" />
                                        <span class="hint">USDT — signed, so enter -50 for a loss level</span>
                                    </template>

                                    <span class="rule-desc hint">{{ describeAutoCloseRule(rule) }}</span>
                                    <button class="rule-remove" :disabled="isRunning" @click="removeAutoCloseRule(rule.id)" title="remove this rule">✕</button>
                                </div>
                            </div>
                        </div>
                    </TabContentComponent>
                </TabComponent>
            </div>
        </div>

        <!-- Chart inspector. Feeds CandleVisualizerV2Component the window
             this simulation is ACTUALLY holding in memory for that symbol,
             via its providedSymbolInfo prop - not IndexedDB, which holds a
             different (live-cached) dataset entirely and would show a
             different period than the one being reviewed. -->
        <div v-if="inspectSymbol" class="modal-overlay" @click.self="closeInspector">
            <div class="modal-content inspect-modal">
                <div class="inspect-header">
                    <strong>{{ inspectSymbol }}</strong>
                    <span class="ml-sm hint" v-if="inspectSymbolInfo">
                        {{ inspectSymbolInfo.candle_15m.length }} × 15m candles in the simulation's window
                        <template v-if="inspectSymbolInfo.candle_15m.length">
                            ({{ new Date(inspectSymbolInfo.candle_15m[0].openTime).toLocaleString() }}
                            → {{ new Date(inspectSymbolInfo.candle_15m[inspectSymbolInfo.candle_15m.length - 1].openTime).toLocaleString() }})
                        </template>
                    </span>
                    <button class="close-btn" @click="closeInspector">✕</button>
                </div>
                <CandleVisualizerV2Component
                    v-if="inspectSymbolInfo"
                    :symbol="inspectSymbol"
                    :provided-symbol-info="inspectSymbolInfo"
                />
                <div v-else class="pa-md">No window held for this symbol.</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * Rolling-window "rigorous test" mode: fetches live from a chosen start
 * date, runs the real analysis pipeline on a bounded 500-candle window
 * per symbol, and walks forward exactly like a real bot would - unable
 * to hold unlimited history, sliding the window one candle at a time
 * as it catches up to the current real-world moment.
 *
 * THE CENTRAL TECHNICAL PROBLEM this had to solve: a position can be
 * open when its own window shifts (oldest candle dropped, one new
 * candle appended). CandleInfo array indices (gi) are NOT stable
 * identities - candle.positionEntry.openGi means "index into THIS
 * PARTICULAR array", which changes meaning entirely once the array
 * shifts. Fixed by:
 *   1. simulationUtilityV2.ts's runAnalysis/runMarketAnalysis accepting
 *      an optional initialOpenPosition + returning the final state, so
 *      a position can be carried forward across calls instead of
 *      always starting fresh.
 *   2. Remapping openGi/closeGi by exactly -1 on every shift (the one
 *      offset every remaining candle's OWN index moved by).
 *   3. runAnalysis's own loop respecting a resumed position's (possibly
 *      already-remapped, possibly negative once its own opening candle
 *      has aged out of the window entirely) openGi.
 *
 * THE ENGINE ONLY MOVES FORWARD. That property is what the pause/next/
 * previous controls are built around - see reviewCursorIndex below for
 * why "previous" reviews recorded history rather than rewinding.
 */
import type { CandleInfo, SymbolInfo, PositionEntry } from '@/core/interfacesv2';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import { SimulationUtilityV2, type EntryOptions } from '@/utility/v2/simulationUtilityV2';
import { KlineUtility } from '@/utility/klineUtility';
import { BinanceMarginUtility } from '@/utility/binanceMarginUtility';
import { estimateCompletion, FIFTEEN_MIN_MS, type CompletionEstimate } from '@/utility/v2/analysis/completionEstimate';
import { evaluatePriceVolumeInterest } from '@/utility/v2/analysis/priceVolumeInterest';
import { forceClosePosition } from '@/utility/v2/analysis/positionEntry';
import { buildSimulationSummary, type SimulationSummary } from '@/utility/v2/analysis/simulationSummary';
import {
    auditPositionWindows, checkWindowIntegrity, type WindowIntegrityReport,
} from '@/utility/v2/analysis/windowIntegrity';
import {
    BUILT_IN_PRESETS, parseUserPresets, serializeUserPresets, upsertUserPreset,
    removeUserPreset, validateSettings, diffSettings,
    type SimulationPreset, type SimulationSettings, type SettingKey,
} from '@/utility/v2/analysis/simulationPresets';
import {
    accrueFundingForInterval, positionQuantity, summarizeFundingCoverage,
    type FundingRateEntry, type FundingCoverage,
} from '@/utility/v2/analysis/fundingCost';
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import JSZip from 'jszip';
import {
    openArchiveDb, clearArchive, putCandles, readSymbol, countRows, putMeta,
    compactCandle, buildArchiveFile, type ArchivedCandle,
} from '@/utility/v2/analysis/runArchive';
import TableComponent from '../../shared/table/TableComponent.vue';
import TableHeaderComponent from '../../shared/table/TableHeaderComponent.vue';
import TableBodyComponent from '../../shared/table/TableBodyComponent.vue';
import TabComponent from '../../shared/tab/TabComponent.vue';
import TabListComponent from '../../shared/tab/TabListComponent.vue';
import TabTriggerComponent from '../../shared/tab/TabTriggerComponent.vue';
import TabContentComponent from '../../shared/tab/TabContentComponent.vue';
import ButtonComponent from '../../shared/form/ButtonComponent.vue';
import InputComponent from '../../shared/form/InputComponent.vue';
import CandleVisualizerV2Component from './CandleVisualizerV2Component.vue';

const props = withDefaults(defineProps<{
    startingBalance?: number;
}>(), {
    startingBalance: 300,
});

const chocoMintoStore = useChocoMintoStore();

const WINDOW_SIZE = 500;
const PAGE_SIZE = 50;

const START_DATETIME_STORAGE_KEY = 'rolling-simulation-start-datetime';
const startDateTimeInput = ref(localStorage.getItem(START_DATETIME_STORAGE_KEY) ?? '');

// "positionEntry only (no gates)". The live-bot loop, nothing else: every tick
// each symbol's latest 500 candles are analysed FROM SCRATCH (as a live fetch of
// 500 would be), checkPositionEntry alone decides an entry at the 500th candle,
// and the window shifts by one. No cap, budget or interest gate, no candle-life
// cap (a position's own maxDurationCandles still applies), and no auto-close /
// liquidation / account-dead stop. Margin still follows the margin settings
// (dynamic margin included), frozen per tick as in the gated mode. Every symbol is
// analysed on every tick, so it is slower than the gated mode - that is the
// real per-candle cost of the live loop.
const MIMIC_RUN_SIMULATION_KEY = 'rolling-simulation-mimic-run-simulation';
const mimicRunSimulation = ref(localStorage.getItem(MIMIC_RUN_SIMULATION_KEY) !== 'false');
watch(mimicRunSimulation, (v) => localStorage.setItem(MIMIC_RUN_SIMULATION_KEY, String(v)));
watch(startDateTimeInput, (value) => {
    localStorage.setItem(START_DATETIME_STORAGE_KEY, value);
});

const BALANCE_STORAGE_KEY = 'rolling-simulation-starting-balance';
const storedBalance = Number(localStorage.getItem(BALANCE_STORAGE_KEY));
const startingBalance = ref(Number.isFinite(storedBalance) && storedBalance > 0 ? storedBalance : props.startingBalance);
watch(startingBalance, (value) => {
    localStorage.setItem(BALANCE_STORAGE_KEY, String(value));
});

const MARGIN_STORAGE_KEY = 'rolling-simulation-margin';
const storedMargin = Number(localStorage.getItem(MARGIN_STORAGE_KEY));
const marginInput = ref(Number.isFinite(storedMargin) && storedMargin > 0 ? storedMargin : 2);
watch(marginInput, (value) => {
    localStorage.setItem(MARGIN_STORAGE_KEY, String(value));
});

// Default LONG on / SHORT off: across two full backtests SHORT produced
// -16.54 and +0.67 net respectively - i.e. nothing or slightly negative
// after fees - despite a higher win rate, while LONG carried effectively
// all the profit. Defaulting SHORT off reflects that measured result;
// the toggle is here so it can be re-tested rather than silently dropped.
// SHORT NOW DEFAULTS ON, changed 2026-09-27. It defaulted OFF on the finding
// that "SHORT contributes nothing", which was measured on the contaminated
// engine. On the archive - 299 symbols, 15m, 2026-01-01 -> 02-06, a -23.7%
// MEDIAN move with only 10% of symbols up - a RANDOM entry earns
//   LONG  -0.1895R (t(day) -2.15)      SHORT +0.1323R (t(day) +1.37)
// so long-only is not a neutral default, it is a directional bet, and it is the
// larger part of the -168.61 this lab has been reporting. A symmetric default
// does not claim shorts are profitable; it declines to bet on the direction
// before the entry has been given a chance to choose it.
// An existing stored preference still wins - only the fallback changed.

// ── Dynamic margin per position ──────────────────────────────────────────
// Scales position SIZE with the account instead of holding it fixed:
// margin = clamp(floor(balance / stepBalance) * stepAmount, floor, ceiling).
// At the defaults (100 / 1) that is margin 1 at a 100 balance, 2 at 200,
// 3 at 300, and so on.
//
// ONE CONSEQUENCE WORTH KNOWING BEFORE ENABLING IT, because it is not
// obvious: the position cap is clamp(balance * ratio / margin, ...). If
// margin itself grows as balance/100, then balance/margin is ~100 at
// every balance, so the cap stops growing and pins at roughly
// 100 * ratio. At ratio 0.4 that is ~40 positions forever. The account
// still scales its total exposure linearly - but by holding FEWER,
// BIGGER positions rather than ever more small ones. That is a real
// change in concentration: a single bad symbol matters more, and
// correlated mass-closes hit harder per event. Whether that is better is
// an empirical question this makes testable, not a given.
const DYNAMIC_MARGIN_KEY = 'rolling-simulation-dynamic-margin';
const MARGIN_STEP_BALANCE_KEY = 'rolling-simulation-margin-step-balance';
const MARGIN_STEP_AMOUNT_KEY = 'rolling-simulation-margin-step-amount';
const MARGIN_FLOOR_KEY = 'rolling-simulation-margin-floor';
const MARGIN_CEILING_KEY = 'rolling-simulation-margin-ceiling';
const storedStepBalance = Number(localStorage.getItem(MARGIN_STEP_BALANCE_KEY));
const storedStepAmount = Number(localStorage.getItem(MARGIN_STEP_AMOUNT_KEY));
const storedMarginFloor = Number(localStorage.getItem(MARGIN_FLOOR_KEY));
const storedMarginCeiling = Number(localStorage.getItem(MARGIN_CEILING_KEY));
const useDynamicMargin = ref(localStorage.getItem(DYNAMIC_MARGIN_KEY) === 'true');
const marginStepBalance = ref(Number.isFinite(storedStepBalance) && storedStepBalance > 0 ? storedStepBalance : 100);
const marginStepAmount = ref(Number.isFinite(storedStepAmount) && storedStepAmount > 0 ? storedStepAmount : 1);
const marginFloorInput = ref(Number.isFinite(storedMarginFloor) && storedMarginFloor > 0 ? storedMarginFloor : 1);
const marginCeilingInput = ref(Number.isFinite(storedMarginCeiling) && storedMarginCeiling > 0 ? storedMarginCeiling : 50);
watch(useDynamicMargin, (v) => localStorage.setItem(DYNAMIC_MARGIN_KEY, String(v)));
watch(marginStepBalance, (v) => localStorage.setItem(MARGIN_STEP_BALANCE_KEY, String(v)));
watch(marginStepAmount, (v) => localStorage.setItem(MARGIN_STEP_AMOUNT_KEY, String(v)));
watch(marginFloorInput, (v) => localStorage.setItem(MARGIN_FLOOR_KEY, String(v)));
watch(marginCeilingInput, (v) => localStorage.setItem(MARGIN_CEILING_KEY, String(v)));

/** Pure: the margin one position should use at a given balance. */
function computeMarginForBalance(balanceValue: number): number {
    if (!useDynamicMargin.value) return marginInput.value;
    const step = marginStepBalance.value;
    const amount = marginStepAmount.value;
    if (!(step > 0) || !(amount > 0)) return marginFloorInput.value;
    // floor(): margin only steps up on crossing a full threshold, so a
    // balance of 299 is still on the 200-tier. A balance below one full
    // step floors to 0, which the clamp lifts to marginFloor - without
    // that, a drawdown under the first step would size every position at
    // 0 and silently stop the account trading.
    const raw = Math.floor(balanceValue / step) * amount;
    return Math.max(marginFloorInput.value, Math.min(marginCeilingInput.value, raw));
}

// Minimum planned reward:risk required to OPEN a position, evaluated at
// the entry candle from (tp - entry)/(entry - sl). Fully causal.
//
// Not an arbitrary number: at win rate p a strategy breaks even when R:R
// equals (1 - p)/p. Over 10,724 LONG trades the win rate was 34.4%,
// putting breakeven at 1.91 - so 2.0 asks each trade to clear its own
// breakeven at the rate actually observed. In that run the sub-1.5 cohort
// was 25.7% of trades and contributed -9,738 net against a +767 total,
// and the effect was monotonic within each third of the run, so it is not
// a time artifact. 0 disables the filter.

// Minimum stop distance as a fraction of entry price. The round-trip taker
// fee is fixed on notional while R is the stop distance, so
// fee/R = 2*taker/(stopDistance/price) - it diverges as the stop tightens.
// Over 5,375 real candidates, 42 had fee > 1.0R and therefore could not
// profit whatever price did (almost all USDCUSDT, worst 615R). 0.01 = stop
// at least 1% away = fee <= 0.10R at 0.05% taker. Only the fee>1R exclusion
// is proven by arithmetic; the exact floor below that is a judgement call.

// Position candle-life cap - not persisted (unlike balance/margin above),
// scoped to this run only.
const maxPositionDurationInput = ref(250);

// How many symbols are processed between yields back to the browser.
// Purely a responsiveness/throughput trade: a bigger number means fewer
// setTimeout(0) hops (each clamped to ~4ms by the browser once nested) but
// longer unbroken synchronous blocks, so the tab feels less responsive.
// Measured cost across a full ~26,000-tick run: 5 yields/tick at 60 is
// ~0.14h, 1 yield/tick at 336 is ~0.03h - so this is worth a few minutes,
// not hours. Left tunable because it is the one knob that trades UI
// smoothness for speed, and the right value depends on the machine.
// How many symbols are initialized at once.
//
// Initialization is two REST round trips per symbol (500 klines, then the
// funding history) followed by one full 500-candle analysis pass. Done one
// at a time across ~336 symbols, almost all of the wall clock is spent
// waiting on the network with the CPU idle, which is what this overlaps.
//
// IT DOES NOT PARALLELIZE THE ANALYSIS. JavaScript runs on one thread, so
// the runMarketAnalysis pass for each symbol still happens one after
// another - only the fetches overlap. The ceiling on the speedup is
// therefore the total CPU time, and raising this past the point where the
// CPU is saturated buys nothing.
//
// KEPT DELIBERATELY MODEST. Binance's USDT-M REST limit is 2,400 request
// weight per minute per IP; a 500-candle kline call costs 2 and a funding
// history call costs 1, so a full init is roughly 1,000 weight. At 6 in
// flight that lands comfortably inside one minute's budget. Pushing it
// high enough to trip the limit earns a 418 IP ban, which costs far more
// than the init ever saves. 1 restores the old strictly-sequential path.
// RANGE RUN. An empty end date keeps the previous behaviour exactly - walk
// until the simulation catches up to the present. With one set, the run stops
// at that candle instead, which is what makes a bounded, repeatable window
// possible: the same range can be re-run after a code change and the two
// results are comparable, which an open-ended run can never be because it
// ends at a different place every day.

/** Filled at initialization by checkWindowIntegrity; exported with the run. */
const windowIntegrityReport = shallowRef<WindowIntegrityReport | null>(null);

/** Tick index of the last rebalance; null until the first one fires. */
let lastCrossSectionRebalanceCandle: number | null = null;

const END_DATE_KEY = 'rolling-simulation-end-datetime';
const endDateTimeInput = ref(localStorage.getItem(END_DATE_KEY) ?? '');
watch(endDateTimeInput, (v) => localStorage.setItem(END_DATE_KEY, v));

const INIT_CONCURRENCY_KEY = 'rolling-simulation-init-concurrency';
const storedInitConcurrency = Number(localStorage.getItem(INIT_CONCURRENCY_KEY));
const initConcurrencyInput = ref(
    Number.isFinite(storedInitConcurrency) && storedInitConcurrency >= 1
        ? Math.min(Math.floor(storedInitConcurrency), 16)
        : 6
);
watch(initConcurrencyInput, (v) => localStorage.setItem(INIT_CONCURRENCY_KEY, String(v)));

const YIELD_EVERY_KEY = 'rolling-simulation-yield-every';
const storedYield = Number(localStorage.getItem(YIELD_EVERY_KEY));
const yieldEverySymbols = ref(Number.isFinite(storedYield) && storedYield > 0 ? storedYield : 60);
watch(yieldEverySymbols, (v) => localStorage.setItem(YIELD_EVERY_KEY, String(v)));

// Dynamic position cap: cap = clamp(balance * ratio / margin, floor, ceiling).
//
// Derived from this strategy's own measured behavior rather than picked:
// at the worst observed single-tick event the whole book closed at ~4.46x
// margin per position (individual positions reach 6.15x, since SL is set
// by ATR at 20x leverage, NOT bounded by margin) - so "margin committed"
// badly understates real exposure and the ratio has to be well under 1.
//
// Backtested on 8 months of real data from a 100 starting balance:
//   ratio 0.07 -> 8.6x final, 43% max drawdown
//   ratio 0.15 -> 13.5x,      63%
//   ratio 0.25 -> 17.1x,      79%
//   ratio 0.33 -> 22.5x,      82%
//   ratio 0.50 -> 17.3x,      98%  <- earns LESS while risking more
// 0.50 earning less than 0.33 is the over-leverage inflection: past it,
// drawdowns damage compounding faster than extra positions add profit.
// These ratios are fitted to one crypto-uptrend window, so treat 0.20 as
// a starting point to observe rather than an optimum.
const CAP_RATIO_KEY = 'rolling-simulation-cap-ratio';
const CAP_FLOOR_KEY = 'rolling-simulation-cap-floor';
const CAP_CEILING_KEY = 'rolling-simulation-cap-ceiling';
const storedRatio = Number(localStorage.getItem(CAP_RATIO_KEY));
const storedFloor = Number(localStorage.getItem(CAP_FLOOR_KEY));
const storedCeiling = Number(localStorage.getItem(CAP_CEILING_KEY));
const positionCapRatioInput = ref(Number.isFinite(storedRatio) && storedRatio > 0 ? storedRatio : 0.20);
// Floor so a drawdown can't strangle recovery; ceiling so a large balance
// doesn't recreate the correlated-exposure problem the cap exists to stop
// (916 of 919 positions in the damaging mass-close events were LONG).
const positionCapFloorInput = ref(Number.isFinite(storedFloor) && storedFloor > 0 ? storedFloor : 3);
const positionCapCeilingInput = ref(Number.isFinite(storedCeiling) && storedCeiling > 0 ? storedCeiling : 50);

// =====================================================================
// PRESETS
//
// THE REF TABLE IS THE GUARD. Typed as RefsFor<SimulationSettings>, so a key in
// the interface with no ref here, or a ref here that is not in the interface, is
// a COMPILE ERROR. The failure this prevents is the quiet one: adding a setting,
// forgetting the preset, and having presets restore a stale value for it while
// appearing to restore everything - which makes two runs incomparable in a way
// that looks exactly like a result.
//
// It must be declared after every input ref above, because it references them.
// =====================================================================
type RefsFor<S> = { [K in keyof S]: { value: S[K] } };

const SETTING_REFS: RefsFor<SimulationSettings> = {
    startDateTime: startDateTimeInput,
    endDateTime: endDateTimeInput,
    startingBalance,
    margin: marginInput,
    useDynamicMargin,
    marginStepBalance,
    marginStepAmount,
    marginFloor: marginFloorInput,
    marginCeiling: marginCeilingInput,
    positionCapRatio: positionCapRatioInput,
    positionCapFloor: positionCapFloorInput,
    positionCapCeiling: positionCapCeilingInput,
    maxPositionDurationCandles: maxPositionDurationInput,
    initConcurrency: initConcurrencyInput,
    yieldEverySymbols,
};

const SETTING_KEYS = Object.keys(SETTING_REFS) as SettingKey[];

/** The configuration as it stands right now. */
function captureSettings(): SimulationSettings {
    const out = {} as SimulationSettings;
    for (const key of SETTING_KEYS) {
        (out as unknown as Record<string, unknown>)[key] = SETTING_REFS[key].value;
    }
    return out;
}

/**
 * Write a whole configuration into the inputs.
 *
 * ALL OR NOTHING. There is no partial apply, because a half-applied preset is
 * the exact failure presets exist to prevent: a run that looks like the named
 * configuration and is not it. Each ref's own `watch` persists it as usual, so
 * an applied preset survives a reload without this needing to know about that.
 */
function applySettings(settings: SimulationSettings): void {
    for (const key of SETTING_KEYS) {
        (SETTING_REFS[key] as { value: unknown }).value = settings[key];
    }
}

const PRESETS_KEY = 'rolling-simulation-presets';
const userPresets = ref<SimulationPreset[]>([]);
const presetLoadNote = ref('');
{
    const { presets, dropped } = parseUserPresets(localStorage.getItem(PRESETS_KEY));
    userPresets.value = presets;
    if (dropped) presetLoadNote.value = `${dropped} saved preset(s) could not be read and were skipped.`;
}

const allPresets = computed<SimulationPreset[]>(() => [...BUILT_IN_PRESETS, ...userPresets.value]);
const selectedPresetName = ref('');
const newPresetName = ref('');
const presetMessage = ref('');

const selectedPreset = computed<SimulationPreset | null>(() =>
    allPresets.value.find(p => p.name === selectedPresetName.value) ?? null);

/**
 * Which fields currently differ from the selected preset.
 *
 * Shown rather than hidden because "I applied the control preset" and "the
 * settings ARE the control preset" are different claims, and only the second one
 * makes a run comparable. Any edit after applying breaks it, and silently.
 */
const presetDrift = computed<SettingKey[]>(() =>
    selectedPreset.value ? diffSettings(captureSettings(), selectedPreset.value.settings) : []);

function applySelectedPreset(): void {
    const preset = selectedPreset.value;
    if (!preset) { presetMessage.value = 'Pick a preset first.'; return; }
    // Re-validated even for a built-in, so a preset stored by an older build and
    // one compiled in take the same path and report the same way.
    const { settings, missing, invalid } = validateSettings(preset.settings);
    applySettings(settings);
    const notes: string[] = [];
    if (missing.length) notes.push(`${missing.length} field(s) not in the saved preset, left at the base value: ${missing.join(', ')}`);
    if (invalid.length) notes.push(`${invalid.length} field(s) unreadable, left at the base value: ${invalid.join(', ')}`);
    presetMessage.value = notes.length
        ? `Applied "${preset.name}". ${notes.join('. ')}`
        : `Applied "${preset.name}" — all ${SETTING_KEYS.length} settings.`;
}

function saveCurrentAsPreset(): void {
    const { presets, error } = upsertUserPreset(
        userPresets.value, newPresetName.value, captureSettings(), Date.now());
    if (error) { presetMessage.value = error; return; }
    const replaced = userPresets.value.some(
        p => p.name.toLowerCase() === newPresetName.value.trim().toLowerCase());
    userPresets.value = presets.filter(p => !p.builtIn);
    localStorage.setItem(PRESETS_KEY, serializeUserPresets(userPresets.value));
    selectedPresetName.value = newPresetName.value.trim();
    presetMessage.value = `${replaced ? 'Replaced' : 'Saved'} "${selectedPresetName.value}" `
        + `with all ${SETTING_KEYS.length} settings.`;
    newPresetName.value = '';
}

function deleteSelectedPreset(): void {
    const preset = selectedPreset.value;
    if (!preset) { presetMessage.value = 'Pick a preset first.'; return; }
    if (preset.builtIn) { presetMessage.value = 'Built-in presets cannot be deleted.'; return; }
    userPresets.value = removeUserPreset(userPresets.value, preset.name).filter(p => !p.builtIn);
    localStorage.setItem(PRESETS_KEY, serializeUserPresets(userPresets.value));
    selectedPresetName.value = '';
    presetMessage.value = `Deleted "${preset.name}".`;
}

watch(positionCapRatioInput, (v) => localStorage.setItem(CAP_RATIO_KEY, String(v)));
watch(positionCapFloorInput, (v) => localStorage.setItem(CAP_FLOOR_KEY, String(v)));
watch(positionCapCeilingInput, (v) => localStorage.setItem(CAP_CEILING_KEY, String(v)));

// ── Auto-close rules ─────────────────────────────────────────────────────
// A LIST of independently-enabled rules, replacing the previous single
// exclusive mode. Every enabled rule is evaluated on every tick and ANY
// of them firing force-closes EVERY open position across every symbol -
// they're OR'd, not prioritized. An empty list (the default) means the
// per-position duration cap is the only thing that ever closes early.
//
// Each rule carries every parameter field regardless of type, rather than
// being a discriminated union. That's deliberate for a form-bound object:
// switching a rule's type in the dropdown keeps the other types' values
// intact instead of destroying them, so you can flip between two
// configurations while comparing without retyping. The cost is that an
// inactive field is still present in the exported JSON - read only the
// field(s) the rule's own type uses.
type AutoCloseRuleType =
    | 'DAILY_TIME'
    | 'EVERY_N_DAYS'
    | 'EVERY_N_HOURS'
    | 'OPEN_PNL_ABOVE'
    | 'OPEN_PNL_BELOW';

interface AutoCloseRule {
    id: string;
    type: AutoCloseRuleType;
    enabled: boolean;
    dailyHour: number;      // 1-12, paired with dailyAmPm
    dailyMinute: number;    // 0-59
    dailyAmPm: 'AM' | 'PM';
    everyNDays: number;
    everyNHours: number;
    // Signed USDT, read against TOTAL open pnl across every open position.
    // ABOVE fires at >= threshold (enter +50), BELOW at <= threshold
    // (enter -50). Signed rather than "magnitude + direction" so the
    // number in the box is literally the pnl value being compared - no
    // mental sign-flipping when reading a rule back later.
    pnlThreshold: number;
}

const AUTO_CLOSE_RULES_KEY = 'rolling-simulation-auto-close-rules';

function makeAutoCloseRule(type: AutoCloseRuleType = 'EVERY_N_HOURS'): AutoCloseRule {
    return {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        enabled: true,
        dailyHour: 12,
        dailyMinute: 0,
        dailyAmPm: 'AM',
        everyNDays: 1,
        everyNHours: 1,
        pnlThreshold: type === 'OPEN_PNL_BELOW' ? -50 : 50,
    };
}

function loadStoredRules(): AutoCloseRule[] {
    // Defensive: a stored blob from an older shape (or hand-edited) must
    // not break startup. Anything unparseable falls back to no rules,
    // which is the same as the old NONE default.
    try {
        const raw = localStorage.getItem(AUTO_CLOSE_RULES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((r: Partial<AutoCloseRule>) => ({ ...makeAutoCloseRule(), ...r }));
    } catch {
        return [];
    }
}

// Per-rule last-fired time, for the elapsed-time rule types. Keyed by
// rule id rather than a single shared timestamp, so two elapsed rules
// (say "every 4 hours" and "every 2 days") keep independent clocks
// instead of resetting each other.
const ruleLastFiredAt = new Map<string, number>();

/** Every auto-close that actually fired, for the export. */
interface AutoCloseEvent {
    timestamp: number;
    openPnlAtTrigger: number;
    positionsClosed: number;
    ruleIds: string[];
    ruleDescriptions: string[];
}
const autoCloseEvents = ref<AutoCloseEvent[]>([]);

const autoCloseRules = ref<AutoCloseRule[]>(loadStoredRules());
watch(autoCloseRules, (v) => {
    localStorage.setItem(AUTO_CLOSE_RULES_KEY, JSON.stringify(v));
}, { deep: true });

function addAutoCloseRule() {
    autoCloseRules.value.push(makeAutoCloseRule());
}

function removeAutoCloseRule(id: string) {
    autoCloseRules.value = autoCloseRules.value.filter(r => r.id !== id);
    ruleLastFiredAt.delete(id);
}

const AUTO_CLOSE_RULE_LABELS: Record<AutoCloseRuleType, string> = {
    DAILY_TIME: 'close all every [time] (UTC)',
    EVERY_N_DAYS: 'close all every [x] days',
    EVERY_N_HOURS: 'close all every [x] hours',
    OPEN_PNL_ABOVE: 'close all when open PNL rises to [x]',
    OPEN_PNL_BELOW: 'close all when open PNL falls to [x]',
};

const isRunning = ref(false);
const statusMessage = ref('');
// Settings first: the run button is disabled until a start date/time is
// set, and that input now lives in this tab.
const selectedTab = ref('Settings');
let stopRequested = false;

interface SymbolRollingState {
    window: CandleInfo[];
    stagingCandles: CandleInfo[];
    lastFetchedOpenTime: number | null;
    openPosition: PositionEntry | null;
    exhausted: boolean; // true once a fetch returns nothing further - stop trying this symbol
    /** This symbol's real funding settlements over the run's range,
     *  fetched once during initialization. Empty means funding could not
     *  be priced for it - reported rather than silently treated as 0. */
    fundingRates: FundingRateEntry[];
}
const symbolStates = new Map<string, SymbolRollingState>();

/** Positions that resolved somewhere other than the window's last candle,
 *  i.e. invisible to recordTick and therefore never settled. An engine
 *  invariant, exported with the run: it must stay 0. Declared here, beside
 *  symbolStates, because shiftSymbolWindow increments it far above where
 *  the funding state lives. */
const unrecordedResolutionCount = ref(0);

// Throughput telemetry: how many symbol-ticks skipped the full re-analysis
// versus ran it. The skip ratio is the speedup actually achieved.
const skippedSymbolTicks = ref(0);
const analyzedSymbolTicks = ref(0);

interface RunStats {
    won: number;
    loss: number;
    // Positions the DURATION CAP closed, not the strategy.
    //
    // NOT a third bucket alongside won/loss - it OVERLAPS them.
    // forceClosePosition still labels an expiry WON or LOSS by the sign
    // of its mark-to-market pnl, so every expired position is also
    // counted in one of those two. won + loss remains the total closed;
    // expired says how many of that total were exited by the cap rather
    // than by price reaching TP or SL.
    expired: number;
    totalTakerFee: number;
    totalClosedPnl: number;
    totalOpenPnl: number;
    /** Entry-side taker fees only. Split from exit so the report can
     *  show that round-trip cost is roughly double what was charged
     *  before exit fees existed. totalTakerFee stays the sum. */
    totalEntryFee: number;
    totalExitFee: number;
    /** Cumulative funding paid across every position, open and closed.
     *  Positive = paid out. A real cost, charged on notional. */
    totalFundingPaid: number;
}
const stats = ref<RunStats>({ won: 0, loss: 0, expired: 0, totalTakerFee: 0, totalEntryFee: 0, totalExitFee: 0, totalClosedPnl: 0, totalOpenPnl: 0, totalFundingPaid: 0 });

interface OpenPositionRow {
    symbol: string;
    position: PositionEntry;
    openTime: number;
    currentPrice: number;
    markToMarketPnl: number;
}
const openPositionsDisplay = ref<OpenPositionRow[]>([]);

// ── Pause / step ─────────────────────────────────────────────────────────
// The main walk loop awaits waitWhilePaused() at the top of every tick.
// Pausing leaves the loop parked on that await; resuming (or a single
// step) resolves it. stepRequested lets exactly ONE tick through while
// staying paused - the loop comes straight back to the gate afterwards.
const isPaused = ref(false);
let resumeResolver: (() => void) | null = null;
let stepRequested = false;

function togglePause() {
    if (isPaused.value) {
        isPaused.value = false;
        releaseGate();
        statusMessage.value = 'resumed';
    } else {
        isPaused.value = true;
        statusMessage.value = 'paused';
    }
}

function releaseGate() {
    if (resumeResolver) {
        const resolve = resumeResolver;
        resumeResolver = null;
        resolve();
    }
}

async function waitWhilePaused(): Promise<void> {
    while (isPaused.value && !stopRequested) {
        if (stepRequested) {
            stepRequested = false;
            return; // let exactly this one tick through
        }
        await new Promise<void>((resolve) => { resumeResolver = resolve; });
    }
}

/** Advances the ENGINE by exactly one tick while staying paused. */
function stepEngineOnce() {
    if (!isRunning.value || !isPaused.value) return;
    stepRequested = true;
    releaseGate();
}

// ── Timeline review cursor ───────────────────────────────────────────────
// null = following the live edge. A number = reviewing that snapshot
// index, with the engine parked wherever it already is.
//
// WHY "previous" DOESN'T REWIND THE ENGINE: shiftSymbolWindow is
// destructive by design - it drops the oldest candle out of the array,
// decrements openGi/closeGi in place, and lets runAnalysis mutate the
// shared positionEntry objects. None of that is reversible, and the only
// way to make it so would be snapshotting every symbol's whole 500-candle
// window (336 x 500 CandleInfo, each carrying every computed field) on
// every tick. So the cursor reviews what was RECORDED instead. The engine
// is forward-only, and this control is honest about that rather than
// pretending otherwise.
const reviewCursorIndex = ref<number | null>(null);
const activeSnapshotIndex = computed(() => reviewCursorIndex.value ?? snapshots.value.length - 1);
const activeSnapshot = computed(() => snapshots.value[activeSnapshotIndex.value] ?? null);

function setReviewCursor(index: number) {
    if (index < 0 || index >= snapshots.value.length) return;
    reviewCursorIndex.value = index === snapshots.value.length - 1 ? null : index;
}

function jumpToLive() {
    reviewCursorIndex.value = null;
}

const canReviewPrevious = computed(() => activeSnapshotIndex.value > 0);
// Forward is available either to move the cursor toward the live edge, or
// - once already AT the live edge, paused, and still running - to advance
// the engine itself by one tick.
const canReviewNext = computed(() =>
    reviewCursorIndex.value !== null || (isRunning.value && isPaused.value)
);

function reviewPrevious() {
    const current = activeSnapshotIndex.value;
    if (current <= 0) return;
    reviewCursorIndex.value = current - 1;
}

function reviewNext() {
    if (reviewCursorIndex.value === null) {
        stepEngineOnce();
        return;
    }
    const next = reviewCursorIndex.value + 1;
    reviewCursorIndex.value = next >= snapshots.value.length - 1 ? null : next;
}

// ── Per-tick position roster (for reviewing past ticks) ──────────────────
// openPositionsDisplay only ever holds the CURRENT tick, so reviewing an
// earlier tick needs its own recorded roster. Stored as a plain sliding
// window rather than one entry per snapshot: a full 8-month run is ~23,000
// ticks and can hold 50 positions at a time, so keeping every roster
// forever is tens of MB of live objects. ROSTER_HISTORY_LIMIT bounds it -
// beyond that the snapshot keeps its aggregate numbers (open count, pnl,
// cap) and only the per-symbol breakdown is dropped, which the UI says
// explicitly rather than showing a misleading empty list.
//
// The limit is ARBITRARY. 2000 ticks is ~20 days of 15m candles; it was
// picked to keep worst-case retained rosters in the low tens of MB, not
// derived from anything measured.
const ROSTER_HISTORY_LIMIT = 2000;

interface RosterRow {
    symbol: string;
    side: 'LONG' | 'SHORT';
    openTime: number;
    /** This position's OWN margin - not the tick's. With dynamic sizing a
     *  book holds several sizes at once, and the mix is only visible if
     *  each row carries its own. */
    margin: number;
    entryPrice: number;
    currentPrice: number;
    markToMarketPnl: number;
}
const rosterWindow: RosterRow[][] = [];
let rosterBaseIndex = 0;
// Plain arrays above (not refs) to avoid making every roster row deeply
// reactive - this counter is what the displayed computed depends on.
const rosterVersion = ref(0);

function pushRoster(rows: RosterRow[]) {
    rosterWindow.push(rows);
    while (rosterWindow.length > ROSTER_HISTORY_LIMIT) {
        rosterWindow.shift();
        rosterBaseIndex++;
    }
    rosterVersion.value++;
}

function rosterAt(snapshotIndex: number): RosterRow[] | null {
    const i = snapshotIndex - rosterBaseIndex;
    if (i < 0 || i >= rosterWindow.length) return null;
    return rosterWindow[i];
}

const rosterAvailableAtCursor = computed(() => {
    void rosterVersion.value; // reactive dependency: rosterWindow itself is a plain array
    return rosterAt(activeSnapshotIndex.value) !== null;
});

/** The positions shown in the Open Symbols tab: live edge or reviewed tick. */
const displayedPositions = computed<RosterRow[]>(() => {
    void rosterVersion.value; // reactive dependency: rosterWindow itself is a plain array
    if (reviewCursorIndex.value === null) {
        return openPositionsDisplay.value.map(row => ({
            symbol: row.symbol,
            side: row.position.side,
            openTime: row.openTime,
            margin: row.position.margin,
            entryPrice: row.position.entryPrice,
            currentPrice: row.currentPrice,
            markToMarketPnl: row.markToMarketPnl,
        })).sort((a, b) => b.openTime - a.openTime);
    }
    return rosterAt(activeSnapshotIndex.value) ?? [];
});

interface ResolvedPositionRecord {
    symbol: string;
    openTime: number;
    closeTime: number;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    sl: number;
    tp: number;
    margin: number;
    leverage: number;
    entryFee: number;
    status: 'WON' | 'LOSS';
    // null only for records produced before closeReason existed - a
    // report must read that as "unknown", not as zero for any bucket.
    closeReason: PositionEntry['closeReason'] | null;
    // ATR-normalized worst-adverse / best-favorable excursion from entry,
    // as of the candle this position resolved on. Copied out because the
    // PositionEntry they live on is a SHARED, MUTATED object that gets
    // reused - reading them later would give some other position's
    // numbers, the same trap walkingPnl exists to avoid.
    mae: number;
    mfe: number;
    /** The actual fill, which differs from sl/tp when the candle gapped
     *  through the level. */
    /** Price excursions from entry - the analysable pair. See
     *  PositionEntry.maePrice for why mae/mfe above are not. */
    maePrice: number;
    mfePrice: number;
    atrAtEntry: number;
    exitPrice: number | null;
    exitFee: number | null;
    /** Funding this position paid over its life, positive = paid. */
    fundingPaid: number;
    pnl: number | null;
    walkingPnl: (number | null)[];
    entryReason: PositionEntry['entryReason'];
}
const resolvedPositionsLog = ref<ResolvedPositionRecord[]>([]);

interface AccountSnapshot {
    timestamp: number;
    won: number;
    loss: number;
    // Cumulative, same as won/loss above (and overlapping them the same
    // way) - so a row reads "of the N closed by this tick, E were the
    // cap giving up". Per-tick expiries are the difference between two
    // consecutive rows.
    expired: number;
    open: number;
    totalTakerFee: number;
    totalEntryFee: number;
    totalExitFee: number;
    /** Funding charged up to this tick, cumulative. Previously absent
     *  from snapshots entirely, so the Account table could not show a
     *  cost that was already coming out of the balance. */
    totalFundingPaid: number;
    totalClosedPnl: number;
    totalOpenPnl: number;
    marginBalance: number;
    balance: number;
    estimatedMaintenanceMargin: number;
    // The tightest cap the gate actually ENFORCED during this tick, after
    // capital committed. positionCap below is the forward-looking figure
    // from the settled balance; the two differ by design, and comparing
    // `open` against the wrong one made benign rows look like breaches.
    enforcedCap: number;
    // The dynamic position cap in force AT THIS TICK. Recorded per-row
    // because it moves with balance - without it there's no way to tell,
    // after the fact, whether a given tick was capped out or simply had
    // no qualifying signals.
    positionCap: number;
    /** The per-position margin in force at this tick. Recorded for the
     *  same reason positionCap is: with dynamic sizing it moves with
     *  balance, and a row is otherwise uninterpretable after the fact. */
    marginPerPosition: number;
}
const snapshots = ref<AccountSnapshot[]>([]);
const snapshotsPage = ref(1);
const totalSnapshotsPages = computed(() => Math.max(1, Math.ceil(snapshots.value.length / PAGE_SIZE)));

/**
 * Descending (most recent first) - page 1 always shows the latest
 * progress. snapshots.value itself stays chronological internally (that's
 * how it's pushed as the walk proceeds, and the export relies on that
 * order); only this display copy is reversed. Each row carries its ORIGINAL
 * chronological index so clicking it can set the review cursor correctly -
 * reversing without that would make the row's position on screen useless
 * as an identifier.
 */
const pagedSnapshots = computed(() => {
    const total = snapshots.value.length;
    const start = (snapshotsPage.value - 1) * PAGE_SIZE;
    const rows: Array<{ index: number; snapshot: AccountSnapshot }> = [];
    for (let offset = 0; offset < PAGE_SIZE; offset++) {
        const reversedPos = start + offset;
        if (reversedPos >= total) break;
        const index = total - 1 - reversedPos;
        rows.push({ index, snapshot: snapshots.value[index] });
    }
    return rows;
});

const estimatedMarginUsed = computed(() =>
    openPositionsDisplay.value.reduce((sum, row) => sum + row.position.margin, 0)
);
const estimatedMaintenanceMargin = computed(() =>
    openPositionsDisplay.value.reduce((sum, row) => {
        const notional = row.position.margin * row.position.leverage;
        return sum + BinanceMarginUtility.calculateMaintenanceMargin(row.symbol, notional);
    }, 0)
);
const balance = computed(() =>
    // Funding is a REAL cash cost, settled as it accrues, so it comes out
    // of balance exactly like fees do - not netted against pnl at close.
    (startingBalance.value - (estimatedMarginUsed.value + stats.value.totalTakerFee + stats.value.totalFundingPaid))
    + stats.value.totalClosedPnl
);
const marginBalance = computed(() =>
    balance.value + estimatedMarginUsed.value + stats.value.totalOpenPnl
);

/** The margin a NEW position would take at the current balance. Display
 *  value; the engine uses marginThisTick, frozen at each tick's start. */
const effectiveMargin = computed(() => computeMarginForBalance(balance.value));

// The margin in force for the CURRENT tick, frozen before any symbol is
// processed. Recomputing per symbol would make position size depend on
// Map iteration order - balance falls as each position commits margin, so
// the first symbol processed would get a larger position than the last,
// for no reason other than where it sits in the list. Freezing it makes
// a tick's sizing uniform and reproducible.
let marginThisTick = 0;

// REALIZED equity, frozen per tick: free cash plus the margin currently
// committed. This is the cap's basis, and getting it wrong is what made the
// cap self-limiting - see currentCapThisTick.
//
// `balance` in this engine is FREE CASH, not equity:
//     startingBalance - marginUsed - fees - funding + closedPnl
// so it FALLS as positions open. Deriving the cap from it means the cap
// shrinks precisely because you used it.
//
// Excludes totalOpenPnl on purpose. marginBalance would include unrealized
// profit on open positions, and sizing new risk off gains that have not been
// banked is how an account gives everything back in one adverse stretch. This
// basis still shrinks when the account actually LOSES - closed losses reduce
// it - which is the dynamic-cap behaviour that was wanted.
let realizedEquityThisTick = 0;

// ── RUN ARCHIVE ──────────────────────────────────────────────────────
// Every candle the run walks, compacted and written to IndexedDB so the
// whole range can be exported afterwards. See runArchive.ts for why the
// record is compact: storing analysed candles for a two-month range across
// 336 symbols would be 5.9 GB, and this is ~250 MB.
//
// WRITES CANNOT AFFECT RESULTS. Nothing here is read back during the walk.
// Rows are keyed [symbol, openTime], so the re-walk writing the same candle
// again overwrites its own row rather than appending - the same idempotence
// `exitFee` and the index-based walkingPnl write rely on.
let archiveDb: IDBDatabase | null = null;
const archiveBuffer = new Map<string, ArchivedCandle[]>();
let archiveBufferedRows = 0;
const archiveRawCandles = ref(0);
const archiveSignalCandles = ref(0);
const archiveEnabled = ref(true);
const archiveError = ref<string | null>(null);

/** Buffers rows; flushes once enough have accumulated to be worth a
 *  transaction. Never awaited from inside the per-symbol loop. */
function archiveCandles(symbol: string, rows: ArchivedCandle[]): void {
    if (!archiveEnabled.value || !archiveDb || !rows.length) return;
    const list = archiveBuffer.get(symbol);
    if (list) list.push(...rows);
    else archiveBuffer.set(symbol, [...rows]);
    archiveBufferedRows += rows.length;
    for (const r of rows) {
        archiveRawCandles.value++;
        if (r.s) archiveSignalCandles.value++;
    }
}

const ARCHIVE_FLUSH_ROWS = 20000;

async function flushArchive(force = false): Promise<void> {
    if (!archiveDb || (!force && archiveBufferedRows < ARCHIVE_FLUSH_ROWS)) return;
    const pending = Array.from(archiveBuffer.entries());
    archiveBuffer.clear();
    archiveBufferedRows = 0;
    try {
        for (const [symbol, rows] of pending) await putCandles(archiveDb, symbol, rows);
    } catch (e) {
        // An archive failure must not take the run down with it - the run is
        // the experiment, the archive is a recording of it. Surfaced, not
        // swallowed: a partial archive that looks complete is worse than none.
        archiveError.value = e instanceof Error ? e.message : String(e);
        archiveEnabled.value = false;
    }
}

const maxConcurrentPositionsInput = computed(() => {
    const ratio = positionCapRatioInput.value;
    const margin = effectiveMargin.value;
    if (!(ratio > 0) || !(margin > 0)) return positionCapFloorInput.value;
    // Sized off realized EQUITY - free cash plus committed margin - not free
    // cash alone, so it matches what currentCapThisTick enforces. Using
    // `balance` here showed a cap that shrank as positions opened, which is
    // why `open` appeared to sit at its ceiling when it was really the
    // ceiling coming down to meet it.
    //
    // It still grows as the account grows and shrinks after losses - the
    // opposite of a fixed cap, which silently de-risks on the way up and
    // over-risks on the way down.
    const raw = Math.floor(((balance.value + estimatedMarginUsed.value) * ratio) / margin);
    return Math.max(positionCapFloorInput.value, Math.min(positionCapCeilingInput.value, raw));
});

// ── Live panel derived values ────────────────────────────────────────────
const equityDelta = computed(() => marginBalance.value - startingBalance.value);
const equityMultiple = computed(() =>
    startingBalance.value > 0 ? marginBalance.value / startingBalance.value : null
);
const liveWinRate = computed(() => {
    const closed = stats.value.won + stats.value.loss;
    return closed > 0 ? stats.value.won / closed : null;
});
/** Share of the CURRENT dynamic cap in use, clamped to 1 for the bar.
 *  Clamped only for display - the cap is enforced elsewhere and the raw
 *  counts are shown next to the bar, so clamping hides nothing. */
const capUtilization = computed(() => {
    const cap = maxConcurrentPositionsInput.value;
    if (!(cap > 0)) return 0;
    return Math.min(1, openPositionsDisplay.value.length / cap);
});

const completionEstimateDisplay = ref<CompletionEstimate | null>(null);
/**
 * WALL-CLOCK TIMING. Without it "the run is slow" cannot be measured, compared
 * across a change, or attributed to a phase - which is the state this was in
 * when a run was first reported as slow: the export carried simulation
 * timestamps and not one real-world millisecond.
 *
 * Kept as plain counters rather than refs: they are written in the hot loop and
 * read once at export, so making them reactive would add a dependency
 * notification per tick for a value nothing renders during the run.
 */
let timeInitMs = 0;
let timeWalkMs = 0;
let timeAnalysisMs = 0;
let timeFetchMs = 0;
let timeArchiveMs = 0;
let timeCrossSectionMs = 0;

let runStartTimestamp = 0;
/** null = open-ended (previous behaviour); otherwise the last simulated
 *  candle time the run will process. */
let runEndTimestamp: number | null = null;
let runStartRealTimeMs = 0;
let candlesProcessedSoFar = 0;

function buildMinimalSymbolInfo(symbol: string, candles: CandleInfo[]): SymbolInfo {
    return {
        name: symbol,
        candle_15m: candles,
        candle_1h: [], candle_4h: [], candle_1d: [],
        // OI/LS deliberately not fetched for this mode - nothing in the
        // current entry logic reads candle.openInterest/longShort, and
        // this is already the heaviest-refetching mode in the app;
        // skipping them halves the network cost per window shift.
        // Binance's own ~30-day retention on those endpoints would
        // also make them mostly empty for anything older anyway.
        oi_15m: [], oi_1h: [], oi_4h: [], oi_1d: [],
        ls_15m: [], ls_1h: [], ls_4h: [], ls_1d: [],
        trendstats_15m: null,
    } as SymbolInfo;
}

// ── Chart inspector ──────────────────────────────────────────────────────
const inspectSymbol = ref<string | null>(null);
// shallowRef: this holds 500 CandleInfo objects each carrying every
// computed analysis field. Deep reactivity over that is pure overhead -
// the object is swapped wholesale, never mutated field by field.
const inspectSymbolInfo = shallowRef<SymbolInfo | null>(null);

/**
 * Opens the chart for one symbol, built from the window this simulation
 * currently holds in memory for it.
 *
 * IMPORTANT, and stated rather than hidden: this is the symbol's window
 * as of the ENGINE's current position, NOT as of the reviewed cursor
 * tick. The engine is forward-only and keeps exactly one window per
 * symbol, so when the cursor is parked on an earlier tick the chart will
 * show a later window than the roster you clicked from. Pause first, then
 * inspect, if you want the two to line up.
 */
function inspectSymbolChart(symbol: string) {
    const state = symbolStates.get(symbol);
    if (!state || !state.window.length) {
        inspectSymbolInfo.value = null;
        inspectSymbol.value = symbol;
        return;
    }
    // Copy the array (not the candles) so the engine continuing to shift
    // its own window can't mutate what the chart is rendering mid-view.
    inspectSymbolInfo.value = buildMinimalSymbolInfo(symbol, [...state.window]);
    inspectSymbol.value = symbol;
}

function closeInspector() {
    inspectSymbol.value = null;
    inspectSymbolInfo.value = null;
}

// ── Batch window download ────────────────────────────────────────────────
const windowDownloadInProgress = ref(false);
/**
 * How many symbols are loaded, as a REF.
 *
 * `symbolStates` is a plain Map, not a reactive one, so a computed reading
 * `symbolStates.size` has nothing to invalidate it: it evaluates once at mount
 * while the Map is still empty, caches false, and never recomputes. Verified
 * against Vue directly - the effect ran once, returned false, and did not re-run
 * after two symbols were added. That is why "download all symbols" was
 * permanently disabled. A template EXPRESSION reading `.size` still shows the
 * right number, because renders are triggered by other reactive changes and
 * re-read it each time - which is what made the bug look implausible.
 *
 * Kept in step with the Map at the two places it changes. Anything reactive
 * that needs the count must use THIS, never the Map.
 */
const symbolsLoaded = ref(0);
const canDownloadWindows = computed(() => !windowDownloadInProgress.value && symbolsLoaded.value > 0);
const canExport = computed(() =>
    resolvedPositionsLog.value.length > 0 || openPositionsDisplay.value.length > 0 || snapshots.value.length > 0
);

/**
 * Zips every symbol's CURRENT in-memory window as a symbolInfo-shaped
 * JSON, one file per symbol - the same shape CandleVisualizerV2Component's
 * own batch download produces, so the two are interchangeable as inputs.
 *
 * Deliberately NOT sourced from IndexedDB (which is what the visualizer's
 * own batch download reads): IndexedDB holds the live-cached dataset,
 * which is a different period entirely from whatever this simulation is
 * currently walking. The whole point here is to capture THIS period.
 *
 * Symbols with an empty window (never had data, or exhausted) are
 * collected and reported rather than silently written as empty files.
 */
/**
 * Writes the whole archived run to a zip: one file per symbol carrying every
 * candle the run walked plus that symbol's own positions.
 *
 * This is the file the research scripts read. It is NOT the rolling-window
 * download above, which only ever holds the last 500 candles per symbol -
 * the reason every study so far has been stuck at a five-day window.
 */
const fullDataDownloadInProgress = ref(false);
const canDownloadFullData = computed(
    () => !fullDataDownloadInProgress.value && !isRunning.value && archiveRawCandles.value > 0
);

async function downloadFullRunData() {
    if (fullDataDownloadInProgress.value) return;
    fullDataDownloadInProgress.value = true;
    try {
        {
            const flushStartedAt = performance.now();
            await flushArchive(true);
            timeArchiveMs += performance.now() - flushStartedAt;
        }
        if (!archiveDb) archiveDb = await openArchiveDb();
        const storeRows = await countRows(archiveDb);
        if (!storeRows) { statusMessage.value = 'nothing archived to download'; return; }
        // Counted from what is actually written into the zip, not from the
        // store, so the number in run-meta.json always describes the file.
        let total = 0;

        // Positions grouped per symbol so each file is self-contained - a
        // reader never has to join two files to know what was traded.
        const bySymbol = new Map<string, unknown[]>();
        for (const p of resolvedPositionsLog.value) {
            const list = bySymbol.get(p.symbol);
            if (list) list.push(p); else bySymbol.set(p.symbol, [p]);
        }
        for (const row of openPositionsDisplay.value) {
            const list = bySymbol.get(row.symbol);
            if (list) list.push(row.position); else bySymbol.set(row.symbol, [row.position]);
        }

        const zip = new JSZip();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const symbols = Array.from(symbolStates.keys());
        let written = 0;
        for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            const candles = await readSymbol(archiveDb, symbol);
            if (!candles.length) continue;
            zip.file(
                `run-${symbol}.json`,
                JSON.stringify(buildArchiveFile(symbol, candles, bySymbol.get(symbol) ?? []))
            );
            written++;
            total += candles.length;
            if (i % 10 === 0) {
                statusMessage.value = `bundling full run: ${i + 1}/${symbols.length} [${symbol}]`;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        // The run's own settings travel with the data, so a file can be
        // interpreted months later without guessing what produced it.
        zip.file('run-meta.json', JSON.stringify({
            format: 'run-archive/1',
            from: runStartTimestamp,
            to: runEndTimestamp,
            candlesArchived: total,
            // If these two disagree the store was still being written when the
            // count was taken - the files are the authority.
            storeRowsAtDownload: storeRows,
            signalCandles: archiveSignalCandles.value,
            symbols: written,
            settings: {
                startDateTimeInput: startDateTimeInput.value,
                endDateTimeInput: endDateTimeInput.value,
                windowSize: WINDOW_SIZE,
                maxPositionDurationCandles: maxPositionDurationInput.value,
            },
            // Stated rather than implied: the skip optimization means analysis
            // did not run on every symbol-tick, so candles without a signal
            // record are candles the engine never analysed - not candles where
            // nothing fired.
            signalCoverageNote:
                'candles carry a signal record only where analysis ran; ' +
                `${archiveSignalCandles.value} of ${total} rows`,
        }, null, 2));

        statusMessage.value = 'compressing…';
        await new Promise(resolve => setTimeout(resolve, 0));
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `run-full-data-${stamp}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        statusMessage.value = `downloaded full run: ${written} symbols, ${total.toLocaleString()} candles`;
    } catch (e) {
        statusMessage.value = `full-data download failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
        fullDataDownloadInProgress.value = false;
    }
}

async function downloadAllSymbolWindows() {
    if (windowDownloadInProgress.value || symbolStates.size === 0) return;
    windowDownloadInProgress.value = true;
    const skipped: string[] = [];
    try {
        const zip = new JSZip();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        let written = 0;
        let processed = 0;

        for (const [symbol, state] of symbolStates) {
            processed++;
            if (!state.window.length) {
                skipped.push(symbol);
                continue;
            }
            const info = buildMinimalSymbolInfo(symbol, state.window);
            zip.file(`symbolInfo-${symbol}-${stamp}.json`, JSON.stringify(info, null, 2));
            written++;
            // Yield periodically - JSON.stringify over 500 fully-analyzed
            // candles x 336 symbols is enough synchronous work to lock the
            // tab without this, same reason the main walk loop yields.
            if (processed % 25 === 0) {
                statusMessage.value = `bundling windows: ${processed}/${symbolStates.size} [${symbol}]`;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        if (written === 0) {
            statusMessage.value = 'no symbol windows to download';
            return;
        }

        statusMessage.value = 'compressing…';
        await new Promise(resolve => setTimeout(resolve, 0));
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rolling-simulation-windows-${stamp}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        statusMessage.value = skipped.length
            ? `downloaded ${written} symbol windows — ${skipped.length} skipped (no data): ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? '…' : ''}`
            : `downloaded ${written} symbol windows`;
    } finally {
        windowDownloadInProgress.value = false;
    }
}

function resetRun() {
    symbolStates.clear();
    symbolsLoaded.value = 0;
    stats.value = { won: 0, loss: 0, expired: 0, totalTakerFee: 0, totalEntryFee: 0, totalExitFee: 0, totalClosedPnl: 0, totalOpenPnl: 0, totalFundingPaid: 0 };
    openPositionsDisplay.value = [];
    resolvedPositionsLog.value = [];
    snapshots.value = [];
    completionEstimateDisplay.value = null;
    statusMessage.value = '';
    snapshotsPage.value = 1;
    ruleLastFiredAt.clear();
    autoCloseEvents.value = [];
    dashboardSummary.value = null;
    fundingCoverage.clear();
    fundingSymbolsMissing.value = [];
    fundingChargeLog.value = [];
    unrecordedResolutionCount.value = 0;
    skippedSymbolTicks.value = 0;
    analyzedSymbolTicks.value = 0;
    liquidationEvents.value = [];
    wasLiquidated.value = false;
    accountDied.value = false;
    balanceWentNegative.value = false;
    remainingBudgetThisTick = 0;
    openPositionCountThisTick = 0;
    marginThisTick = 0;
    enforcedCapThisTick = 0;
    realizedEquityThisTick = 0;
    stagingInFlight.clear();
    stagingBlockingRefills.value = 0;
    stagingPrefetches.value = 0;
    stagingGaps.value = [];
    capUsedForLastPermittedEntry = 0;
    rosterWindow.length = 0;
    rosterBaseIndex = 0;
    rosterVersion.value++;
    reviewCursorIndex.value = null;
    isPaused.value = false;
    stepRequested = false;
    resumeResolver = null;
    closeInspector();
}

function stopSimulation() {
    stopRequested = true;
    // A stop while parked on the pause gate would otherwise hang forever -
    // release it so the loop can observe stopRequested and unwind.
    isPaused.value = false;
    releaseGate();
}

// Running budget for the CURRENT tick - the actual fix for over-exposure.
// balance.value only updates ONCE PER TICK, after every symbol has already
// been processed for that tick - so checking it alone means every symbol
// sees the SAME, stale, still-positive number regardless of how many OTHER
// symbols already opened a position earlier in the very same tick.
// Confirmed directly: a real run showed open count jump from 29 to 200
// within 20 ticks, balance dropping from +353 to -4 - ~171 positions all
// opening in a short window, each one individually "affordable" against a
// balance snapshot that never updated to reflect the others.
let remainingBudgetThisTick = 0;

// Running count of open positions for the CURRENT tick - same pattern as
// remainingBudgetThisTick, for the same reason, but a DIFFERENT safeguard,
// not a replacement: the budget check alone still let the account go from
// 46 open positions ($305 balance) to 197 open positions ($2 balance) in a
// single 15-minute tick during a real run. Every one of those 151 new
// positions was individually "affordable" against the remaining budget, so
// the budget check correctly allowed each one, right up until the account
// was fully committed with zero buffer left. A hard ceiling on total
// concurrent exposure is what actually prevents that ramp.
let openPositionCountThisTick = 0;

// The tightest cap the gate enforced during the current tick, recorded per
// snapshot so a row is checkable against what actually constrained it.
let enforcedCapThisTick = 0;
// The cap value the gate compared against on its most recent PASS - see
// shouldAllowNewEntry.
let capUsedForLastPermittedEntry = 0;

/**
 * Whether a symbol should be allowed to open a NEW position right now.
 * Three independent gates, all must pass:
 *
 * 1. Concurrency: is TOTAL open exposure already at the configured cap.
 * 2. Capital: would opening one more position at the configured margin
 *    exceed remainingBudgetThisTick.
 * 3. Interest: is this symbol's own recent price action/volume actually
 *    worth trading right now (evaluatePriceVolumeInterest on its own
 *    already-loaded window - no extra fetch, no OI/LS dependency, since
 *    OI/LS isn't reliably available this far back).
 *
 * When any gate fails, an existing open position for that symbol still
 * gets tracked/updated normally (via allowNewEntry=false, not by
 * skipping the symbol entirely) - only the opening of something NEW is
 * held back.
 */
/**
 * The cap AS IT STANDS PART-WAY THROUGH A TICK.
 *
 * maxConcurrentPositionsInput is a computed over `balance`, and `balance`
 * only updates once per tick - so every symbol in a tick sees the cap as it
 * read BEFORE any of that tick's positions committed margin. That is the
 * same staleness behind the original over-exposure, one layer up: with the
 * entry gate fixed, a real run still showed open going 18 -> 29 on one tick
 * against a cap of 25, because 18 + 11 was within the cap at the tick's
 * start and committing those 11 was what pushed it down.
 *
 * remainingBudgetThisTick is already the running free balance (starts at
 * `balance`, decremented as each position opens), so deriving the cap from
 * it makes the cap contract as capital commits - consistent with the budget
 * check beside it, and self-limiting within the tick.
 */
function currentCapThisTick(): number {
    const ratio = positionCapRatioInput.value;
    if (!(ratio > 0) || !(marginThisTick > 0)) return positionCapFloorInput.value;
    // CORRECTED. The previous version derived the cap from
    // `remainingBudgetThisTick - marginThisTick` - free cash after the
    // prospective open - and compared it against the TOTAL open count. Those
    // two move against each other: every position that opens reduces free
    // cash, which reduces the cap, while the count it is compared to rises.
    // The gate therefore settles at the fixed point
    //
    //     n = (E - n*m - m) * ratio / m   ->   n = E*ratio / (m * (1 + ratio))
    //
    // which at E=100, m=1, ratio=0.4 is 28 positions, not the 40 the setting
    // asks for - a 29% cut that gets worse as ratio rises, and that tightens
    // further after every loss because closed losses reduce free cash too.
    // Measured against a real run: the old build held 34 positions on
    // 2026-01-08 where this one held 17, and reached a maximum of 37 against
    // this one's 22 over the same period.
    //
    // The original problem this was written to solve was real - the count
    // outrunning the cap within a tick - but the cause was the cap moving,
    // not the comparison. A basis frozen at the tick's start cannot move
    // while the tick's positions open, so the count cannot outrun it.
    //
    // The cap is not a budget. `remainingBudgetThisTick < marginThisTick`,
    // checked separately in shouldAllowNewEntry, is what stops a position
    // being funded with cash that is not there. This decides CONCURRENCY.
    const raw = Math.floor((realizedEquityThisTick * ratio) / marginThisTick);
    return Math.max(positionCapFloorInput.value, Math.min(positionCapCeilingInput.value, raw));
}


function shouldAllowNewEntry(state: SymbolRollingState): boolean {
    const cap = currentCapThisTick();
    if (openPositionCountThisTick >= cap) return false;
    // Remembered so the snapshot can record the cap that actually PERMITTED
    // an open, rather than one recomputed afterwards. Recomputing after the
    // budget decrements yields a TIGHTER number than the gate ever applied,
    // which made 51 of one run's ticks look like breaches when the gate had
    // behaved correctly (open 23 -> 24 against the cap of 24 it was measured
    // against, recorded as 23 because the post-open budget implied 23).
    capUsedForLastPermittedEntry = cap;
    if (remainingBudgetThisTick < marginThisTick) return false;
    if (!state.window.length) return false;
    return evaluatePriceVolumeInterest(state.window).isInteresting;
}

/** One symbol's initialization result, not yet committed to the run. */
interface InitializedSymbol {
    symbol: string;
    state: SymbolRollingState;
    /** null when the symbol had no candles at all, so nothing was priced. */
    coverage: FundingCoverage | null;
}

/**
 * Fetches and analyzes the FIRST window for one symbol.
 *
 * RETURNS its result rather than writing straight into symbolStates and
 * fundingCoverage, because those two Maps are iterated in INSERTION ORDER
 * and that order is load-bearing:
 *
 *   - the main tick loop walks `for (const [symbol, state] of symbolStates)`,
 *     and every tick is a race between symbols for the remaining budget and
 *     the remaining cap slots (see remainingBudgetThisTick /
 *     openPositionCountThisTick). Whoever is visited first takes the last
 *     free slot.
 *   - fundingCoverage is exported as Array.from(...values()).
 *
 * Initializing in parallel means symbols finish in network-latency order,
 * which is not reproducible between runs. Letting that decide insertion
 * order would silently change which symbols get filled and make two runs of
 * identical settings disagree. The caller therefore commits results in
 * ROSTER order, and this function stays free of that decision.
 */
async function initializeSymbol(symbol: string, startTimestamp: number): Promise<InitializedSymbol> {
    const raw = await KlineUtility.getRecentKlinesByRange(symbol, '15m', WINDOW_SIZE, startTimestamp);
    if (!raw.length) {
        return {
            symbol,
            state: { window: [], stagingCandles: [], lastFetchedOpenTime: null, openPosition: null, exhausted: true, fundingRates: [] },
            coverage: null,
        };
    }

    // Real funding settlements for this symbol, fetched ONCE here rather
    // than per tick. Requested from the run's start to now, so a position
    // opening at any point in the walk already has its rates in hand.
    //
    // Unlike OI/LS (which this mode skips entirely because Binance only
    // retains ~30 days), funding history goes back to listing - so it is
    // available for a simulation starting months ago, which is the whole
    // reason it can be priced from data instead of assumed.
    //
    // A symbol whose fetch fails or returns nothing gets an empty array
    // and is counted in fundingSymbolsMissing, NOT silently charged zero.
    const fundingRates = await KlineUtility.getFundingRatesByRange(symbol, startTimestamp, Date.now());
    const coverage = summarizeFundingCoverage(symbol, fundingRates);
    const candles = SimulationUtilityV2.mapToInfo(raw);
    const symbolInfo = buildMinimalSymbolInfo(symbol, candles);

    // allowNewEntry is HARD false here: the initial 500-candle window is
    // warm-up history, not tradeable time.
    //
    // runAnalysis walks all 500 candles in one call, opening and closing
    // positions sequentially as it goes, with no notion of the portfolio
    // cap - that lives out here, per tick. So letting entries happen
    // during initialization meant every symbol could independently open a
    // position (and, across 336 symbols, blow straight past the cap)
    // before the rolling walk had enforced anything. It also placed those
    // entries at arbitrary points across a window spanning ~5 days of
    // history rather than at a single point in simulated time.
    //
    // Everything else the analysis produces - trend segments, ATR, market
    // structure, volume state - is still computed and retained; only
    // position creation is suppressed.
    const mimic = mimicRunSimulation.value;
    const { openPosition } = await SimulationUtilityV2.runMarketAnalysis(
        symbolInfo, [], null,
        mimic ? undefined : maxPositionDurationInput.value,
        effectiveMargin.value,
        false, true, true,
        // Warm-up opens nothing (allowNewEntry is false), but the index is
        // passed anyway so this call can never behave differently from the
        // shift path if that flag is ever changed.
        candles.length - 1
    );

    return {
        symbol,
        coverage,
        state: {
            window: candles,
            stagingCandles: [],
            lastFetchedOpenTime: candles[candles.length - 1].openTime,
            openPosition, // always null here, by the hard-false above
            exhausted: false,
            fundingRates,
        },
    };
}

/**
 * Slides one symbol's window forward by exactly one candle: pulls the
 * next candle from the staging buffer (fetching a fresh batch first if
 * the staging buffer is empty), appends it, drops the oldest, remaps
 * the carried-over position's openGi/closeGi by the one-index shift
 * this causes, then re-runs analysis on the freshly shifted window.
 */
/**
 * How many candles one staging refill pulls. Each refill is a REST round
 * trip, so this sets how often the simulation has to stop and wait: at 500
 * every symbol refills every 500 ticks. Binance charges request weight 2 for
 * a 500-candle call and 5 for a 1000-candle one, so 1000 buys half the round
 * trips for 2.5x the weight - worth it when the wait is latency, not weight.
 * Left at WINDOW_SIZE so behaviour is unchanged from before this existed.
 */
const STAGING_FETCH_SIZE = WINDOW_SIZE;

/**
 * Symbols with a background refill currently in flight, mapped to the promise
 * so a caller that runs dry can AWAIT the fetch already on its way instead of
 * starting a second one for the same range.
 */
const stagingInFlight = new Map<string, Promise<void>>();

/** Times the tick loop had to block because a buffer ran dry with no refill
 *  in flight. This is the number that says whether prefetching is working:
 *  it should be ~336 (the unavoidable first tick) and then stay flat. */
const stagingBlockingRefills = ref(0);
/** Background refills that completed. */
const stagingPrefetches = ref(0);
/** Candle gaps Binance returned mid-stream, which the continuity guard
 *  caught. Reported rather than patched over - a gap means the symbol's
 *  history is not contiguous and its window would be wrong. */
const stagingGaps = ref<string[]>([]);

/**
 * When a symbol starts its background refill, expressed as candles still left
 * in its buffer.
 *
 * STAGGERED ON PURPOSE, and deterministically. Every symbol is initialized at
 * the same moment, so without this they all cross any fixed threshold on the
 * same tick and the prefetch queue arrives as one burst - which is the stall
 * this is meant to remove, just moved earlier. Spreading the trigger over a
 * 30-70% band turns one burst of 336 into a trickle of a few per tick.
 *
 * Derived from the symbol NAME, not from a random source or from arrival
 * order, so two runs of identical settings schedule identically.
 */
function prefetchThresholdFor(symbol: string): number {
    let h = 0;
    for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) | 0;
    const frac = 0.30 + (Math.abs(h) % 41) / 100;   // 0.30 .. 0.70
    return Math.floor(STAGING_FETCH_SIZE * frac);
}

/**
 * Fetches one symbol's next batch and APPENDS it to the staging buffer.
 *
 * APPEND, NEVER REPLACE. The tick loop is shifting candles off the front of
 * this same array while this runs. Assigning a fresh array - which the
 * original inline fetch does, safely, because it only runs when the buffer is
 * empty - would discard every candle consumed-but-not-yet-reached in between.
 *
 * CONTINUITY IS CHECKED, NOT ASSUMED. The batch must start exactly one
 * interval after the last candle already held. Anything at or before it is
 * dropped as overlap; a genuine gap is recorded and the symbol is retired
 * rather than stitched, because a window with a hole in it produces ATR,
 * trend and structure values for a price series that never existed.
 */
async function fetchStagingBatch(symbol: string, state: SymbolRollingState): Promise<void> {
    const from = state.lastFetchedOpenTime;
    if (from == null) return;
    const raw = await KlineUtility.getRecentKlinesByRange(symbol, '15m', STAGING_FETCH_SIZE, from + FIFTEEN_MIN_MS);
    if (!raw.length) { state.exhausted = true; return; }
    const fetched = SimulationUtilityV2.mapToInfo(raw);

    const lastHeld = state.stagingCandles.length
        ? state.stagingCandles[state.stagingCandles.length - 1].openTime
        : (state.window.length ? state.window[state.window.length - 1].openTime : from);
    const fresh = fetched.filter(c => c.openTime > lastHeld);
    if (!fresh.length) { state.exhausted = true; return; }
    if (fresh[0].openTime !== lastHeld + FIFTEEN_MIN_MS) {
        stagingGaps.value.push(
            `${symbol}: expected ${lastHeld + FIFTEEN_MIN_MS}, got ${fresh[0].openTime}`
        );
        state.exhausted = true;
        return;
    }
    state.stagingCandles.push(...fresh);
    state.lastFetchedOpenTime = fresh[fresh.length - 1].openTime;
}

/**
 * Starts background refills for buffers running low. NON-BLOCKING: it returns
 * immediately and the fetches land during subsequent ticks, so by the time a
 * buffer would have run dry its next batch is already appended.
 *
 * Shares one concurrency budget with everything else so the combined in-flight
 * count cannot exceed the rate-limit headroom the setting allows.
 *
 * SAFE FOR RESULTS. A prefetch only appends candles a symbol was going to
 * fetch anyway, from a start time derived from its own lastFetchedOpenTime -
 * never from arrival order. Whether a batch lands early (prefetched) or late
 * (the blocking fallback) the buffer ends up holding the same candles in the
 * same order, so the simulation sees the same data either way. Completion
 * order changes wall-clock only.
 */
function schedulePrefetch(): void {
    if (stopRequested) return;
    const concurrency = Math.max(1, Math.min(Math.floor(initConcurrencyInput.value) || 1, 16));
    let budget = concurrency - stagingInFlight.size;
    if (budget <= 0) return;
    for (const [symbol, state] of symbolStates) {
        if (budget <= 0) break;
        if (state.exhausted) continue;
        if (stagingInFlight.has(symbol)) continue;
        if (state.lastFetchedOpenTime == null) continue;
        if (state.stagingCandles.length > prefetchThresholdFor(symbol)) continue;
        budget--;
        const task = fetchStagingBatch(symbol, state)
            .then(() => { stagingPrefetches.value++; })
            .catch(() => { /* a failed prefetch just leaves the blocking path to retry */ })
            .finally(() => { stagingInFlight.delete(symbol); });
        stagingInFlight.set(symbol, task);
    }
}

/**
 * Refills every empty staging buffer IN PARALLEL, before the tick's symbol
 * loop runs.
 *
 * WHY THIS EXISTS. Initialization leaves every symbol with an empty staging
 * buffer, so the first main-loop tick had all ~336 symbols fetch, one after
 * another, inside a single tick - and then again every STAGING_FETCH_SIZE
 * ticks, because they all run dry together. That is the stall at candle 501
 * and candle 1001: a few hundred sequential round trips with the CPU idle,
 * reported as one tick making no progress.
 *
 * SAFE FOR RESULTS. This touches only stagingCandles, lastFetchedOpenTime and
 * exhausted, each scoped to its own symbol and read by nothing else until
 * that symbol's own shift. It does not open, close or order anything, and the
 * tick loop still visits symbols in the same order - so the per-tick race for
 * budget and cap slots is untouched.
 *
 * shiftSymbolWindow keeps its own inline fetch as a fallback, so a symbol
 * this misses behaves exactly as it did before.
 */
async function refillStagingBuffers(): Promise<void> {
    // Anything already in flight is left alone - awaiting it is the job of
    // shiftSymbolWindow, and starting a second fetch for the same range would
    // append the same candles twice.
    const pending: Promise<void>[] = [];
    const need: Array<[string, SymbolRollingState]> = [];
    for (const [symbol, state] of symbolStates) {
        if (state.exhausted) continue;
        if (state.stagingCandles.length > 0) continue;
        if (state.lastFetchedOpenTime == null) continue;
        const inflight = stagingInFlight.get(symbol);
        if (inflight) { pending.push(inflight); continue; }
        need.push([symbol, state]);
    }
    // A buffer that ran dry with nothing on its way is a prefetch that did not
    // keep up. Counted, because it is the one number that says whether the
    // background task is doing its job.
    stagingBlockingRefills.value += need.length;
    const refillStartedAt = performance.now();
    if (pending.length) await Promise.all(pending);
    if (!need.length) { timeFetchMs += performance.now() - refillStartedAt; return; }

    const concurrency = Math.max(1, Math.min(Math.floor(initConcurrencyInput.value) || 1, 16));
    let cursor = 0;
    let done = 0;
    const worker = async (): Promise<void> => {
        while (true) {
            if (stopRequested) return;
            const i = cursor++;
            if (i >= need.length) return;
            const [symbol, state] = need[i];
            // Same implementation the background path uses, so the append
            // semantics and the continuity guard exist in exactly one place.
            await fetchStagingBatch(symbol, state);
            done++;
            // Say what it is doing. This phase looks like a hang otherwise -
            // the candle counter does not move while it runs.
            statusMessage.value = `refilling candle buffers: ${done}/${need.length} (${concurrency} at a time)`;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    // Counted on BOTH exits. Only the early return was instrumented at first,
    // which would have reported the blocking fetch as costing almost nothing
    // precisely on the runs where it costs the most - the ones that actually
    // had buffers to refill.
    timeFetchMs += performance.now() - refillStartedAt;
}

async function shiftSymbolWindow(symbol: string, state: SymbolRollingState): Promise<boolean> {
    if (!state.stagingCandles.length) {
        if (state.lastFetchedOpenTime == null) return false;
        // A background refill may already be on its way for this symbol.
        // Awaiting it is not just an optimization: starting a second fetch
        // would request the same range twice and append it twice, silently
        // duplicating candles in the window.
        const inflight = stagingInFlight.get(symbol);
        if (inflight) await inflight;
        // Still empty - nothing was scheduled, or it failed. Fetch inline.
        if (!state.stagingCandles.length) {
            stagingBlockingRefills.value++;
            await fetchStagingBatch(symbol, state);
        }
        if (!state.stagingCandles.length) return false;
    }

    const nextCandle = state.stagingCandles.shift();
    if (!nextCandle) return false;

    state.window.push(nextCandle);
    state.window.shift();

    const mimic = mimicRunSimulation.value;
    if (state.openPosition) {
        state.openPosition.openGi -= 1;
        if (state.openPosition.closeGi != null) state.openPosition.closeGi -= 1;
    }

    // ── THE ACTUAL SPEEDUP ────────────────────────────────────────────
    // runAnalysis re-derives EVERY field on ALL 500 candles on every call
    // (it wipes atr, ema200, candleStructure, volumeState, priceAction,
    // marketStructure, trendState and positionEntry and recomputes them),
    // which is ~97% of this simulation's runtime. For a symbol with no open
    // position AND no permission to open one, that entire pass produces
    // nothing that is read: recordTick only looks for a positionEntry, and
    // there cannot be one.
    //
    // Skipping is safe precisely BECAUSE the pass is stateless. Nothing is
    // carried between calls, so the next call that DOES run rebuilds every
    // field for the whole window from scratch - a skipped tick leaves no
    // gap to repair. The entry gate itself is unaffected: the interest
    // check reads raw OHLCV off the window, never the computed fields, and
    // the window is still advanced above.
    const allowEntryThisSymbol = mimic ? true : shouldAllowNewEntry(state);
    if (!state.openPosition && !allowEntryThisSymbol) {
        skippedSymbolTicks.value++;
        // RAW ONLY, and that is the honest record. The skip means no analysis
        // ran for this symbol on this candle, so there are no derived fields
        // to store - and the engine could not have entered here either, since
        // an entry may only be created at the candle analysis reached. The
        // archive's signal coverage therefore equals the engine's own. Raw
        // OHLCV is still written because forward-path research needs an
        // unbroken price series whether or not a signal fired.
        archiveCandles(symbol, [compactCandle(nextCandle, state.window, state.window.length - 1)]);
        return true;
    }
    analyzedSymbolTicks.value++;

    const positionBefore = state.openPosition;
    // Captured BEFORE the analysis mutates it - the shared position object
    // is updated in place, so reading status afterwards would show the new
    // value and the check below could never fire.
    const statusBefore = positionBefore?.status ?? null;
    const symbolInfo = buildMinimalSymbolInfo(symbol, state.window);
    // Whether a position is already open doesn't need to factor into the
    // gate here - when one is, runAnalysis's own internal branching
    // updates it regardless of allowNewEntry's value; the gate only ever
    // matters for the "no position currently open" case, which is exactly
    // what shouldAllowNewEntry itself is evaluating.
    const analysisStartedAt = performance.now();
    const { openPosition } = await SimulationUtilityV2.runMarketAnalysis(
        symbolInfo, [], state.openPosition,
        mimic ? undefined : maxPositionDurationInput.value,
        marginThisTick,
        allowEntryThisSymbol, true, true,
        // THE FIX. A new position may only be created at the candle the
        // simulation has actually reached. Without this, runAnalysis's
        // re-walk of the whole 500-candle window could create an entry at
        // ANY past candle as soon as the once-per-tick gate opened - at
        // that candle's own price, which is history by then. That bypassed
        // the position cap, the budget check and the per-tick margin
        // freeze all at once (a real run showed 190 concurrent positions
        // against a cap of 100, and 81 entries sharing one openTime), and
        // it is look-ahead besides: the entry price predates the decision.
        // It also made recordTick's last-candle-only read lossy, since a
        // position could open AND resolve inside the window interior
        // without ever being seen - the source of the vanishing open
        // counts and the unattributed funding.
        state.window.length - 1
    );

    timeAnalysisMs += performance.now() - analysisStartedAt;

    // Compare by object IDENTITY, not by null-ness. A single re-analysis
    // pass walks the whole window, so it can resolve the resumed position
    // partway through AND open a brand new one later in that same pass -
    // in which case the old `openPosition && !wasOpenBefore` test saw
    // non-null both before and after, skipped this branch entirely, and
    // silently left the NEW position carrying the PREVIOUS position's
    // openTime. Real exports showed 10.4% of positions with a provably
    // wrong openTime because of this.
    // INVARIANT: a position that resolves must be sitting on the window's
    // last candle, because that is the only place recordTick looks. With
    // entries confined to the last candle this should hold always, so a
    // non-zero count here means the lossy path is back - which is exactly
    // what went unnoticed before, since totalClosedPnl and the trade
    // ledger are written in the same place and agree even when both miss a
    // position. This counter is an INDEPENDENT witness; it is exported.
    if (positionBefore && statusBefore === 'OPEN' && positionBefore.status !== 'OPEN') {
        const lastCandle = state.window[state.window.length - 1];
        if (lastCandle?.positionEntry !== positionBefore) unrecordedResolutionCount.value++;
    }

    const isBrandNewPosition = openPosition != null && openPosition !== positionBefore;
    if (isBrandNewPosition) {
        // Committed HERE, not in the predicate: a candidate can pass the balance
        // veto and still be refused by the R:R gate, the fee guard or the level
        // geometry, and counting those would make the book look more balanced
        // than it is.
        remainingBudgetThisTick -= marginThisTick;
        openPositionCountThisTick += 1;
        // The tightest cap that actually permitted an open this tick.
        enforcedCapThisTick = Math.min(enforcedCapThisTick, capUsedForLastPermittedEntry);
    }
    state.openPosition = openPosition;
    // Analysis ran, so this candle now carries its derived fields. Written
    // last, after the position bookkeeping, so the row reflects the tick's
    // final state. The [symbol, openTime] key means this overwrites nothing
    // but itself if the walk ever revisits the candle.
    archiveCandles(symbol, [compactCandle(state.window[state.window.length - 1], state.window, state.window.length - 1)]);
    return true;
}



function recordTick(nowTimestamp: number, settledKeys: Set<string>, indexOverride?: number) {
    const stillOpenRows: OpenPositionRow[] = [];
    let openPnlThisTick = 0;

    for (const [symbol, state] of symbolStates) {
        if (!state.window.length) continue;
        const idx = indexOverride ?? state.window.length - 1;
        if (idx < 0 || idx >= state.window.length) continue;
        const candle = state.window[idx];
        if (indexOverride != null && candle.openTime !== nowTimestamp) continue;
        const position = candle.positionEntry;
        if (!position) continue;

        if (position.status !== 'OPEN') {
            const posKey = symbol + ':' + position.openGi + ':' + position.closeGi;
            if (!settledKeys.has(posKey)) {
                settledKeys.add(posKey);
                if (position.status === 'WON') stats.value.won++;
                else if (position.status === 'LOSS') stats.value.loss++;
                // Counted IN ADDITION to the won/loss increment above,
                // never instead of it - see RunStats.expired.
                if (position.closeReason === 'EXPIRED') stats.value.expired++;
                stats.value.totalClosedPnl += position.pnl ?? 0;
                // Round trip: entry AND exit. Only the entry fee was
                // ever charged before, understating real cost by close
                // to half - both TP and SL exits are taker fills.
                stats.value.totalEntryFee += position.entryFee ?? 0;
                stats.value.totalExitFee += position.exitFee ?? 0;
                stats.value.totalTakerFee += (position.entryFee ?? 0) + (position.exitFee ?? 0);

                resolvedPositionsLog.value.push({
                    symbol,
                    openTime: position.openTime,
                    closeTime: candle.openTime,
                    side: position.side,
                    entryPrice: position.entryPrice,
                    sl: position.sl,
                    tp: position.tp,
                    margin: position.margin,
                    leverage: position.leverage,
                    entryFee: position.entryFee,
                    status: position.status as 'WON' | 'LOSS',
                    closeReason: position.closeReason ?? null,
                    mae: position.mae,
                    mfe: position.mfe,
                    maePrice: position.maePrice,
                    mfePrice: position.mfePrice,
                    atrAtEntry: position.atrAtEntry,
                    exitPrice: position.exitPrice ?? null,
                    exitFee: position.exitFee ?? null,
                    fundingPaid: position.fundingPaid,
                    pnl: position.pnl,
                    walkingPnl: [...position.walkingPnl],
                    entryReason: position.entryReason,
                });
            }
        } else {
            const pnl = markToMarketPnl(position, candle.close);
            openPnlThisTick += pnl;
            stillOpenRows.push({ symbol, position, openTime: position.openTime, currentPrice: candle.close, markToMarketPnl: pnl });
        }
    }

    openPositionsDisplay.value = stillOpenRows;
    stats.value.totalOpenPnl = openPnlThisTick;

    snapshots.value.push({
        timestamp: nowTimestamp,
        won: stats.value.won,
        loss: stats.value.loss,
        expired: stats.value.expired,
        open: stillOpenRows.length,
        totalTakerFee: stats.value.totalTakerFee,
        totalEntryFee: stats.value.totalEntryFee,
        totalExitFee: stats.value.totalExitFee,
        totalFundingPaid: stats.value.totalFundingPaid,
        totalClosedPnl: stats.value.totalClosedPnl,
        totalOpenPnl: stats.value.totalOpenPnl,
        marginBalance: marginBalance.value,
        balance: balance.value,
        estimatedMaintenanceMargin: estimatedMaintenanceMargin.value,
        enforcedCap: enforcedCapThisTick,
        positionCap: maxConcurrentPositionsInput.value,
        marginPerPosition: effectiveMargin.value,
    });

    // Snapshot the per-symbol breakdown too, as plain values - the live
    // PositionEntry objects are shared and mutated, so storing references
    // here would make every historical roster silently show the position's
    // FINAL state instead of its state at this tick (the same shared-object
    // trap TradeReplayComponent had to work around).
    pushRoster(stillOpenRows.map(row => ({
        symbol: row.symbol,
        side: row.position.side,
        openTime: row.openTime,
        margin: row.position.margin,
        entryPrice: row.position.entryPrice,
        currentPrice: row.currentPrice,
        markToMarketPnl: row.markToMarketPnl,
    })).sort((a, b) => b.openTime - a.openTime));
}

// Per-symbol funding coverage, for the report - what was actually
// priced, so a run never implies coverage it didn't have.
const fundingCoverage = new Map<string, FundingCoverage>();
const fundingSymbolsMissing = ref<string[]>([]);

/** Every funding settlement charged, for the export. */
interface FundingChargeRecord {
    symbol: string;
    fundingTime: number;
    fundingRate: number;
    notional: number;
    amount: number;
    side: 'LONG' | 'SHORT';
}
const fundingChargeLog = ref<FundingChargeRecord[]>([]);


/**
 * Charges funding on every open position for the settlements falling in
 * (previousSimTime, currentSimTime].
 *
 * Called EXACTLY ONCE PER TICK from the main loop - deliberately not
 * inside updatePositionEntry, which the rolling simulation re-runs over
 * its whole 500-candle window on every single shift. Accruing there
 * would multiply every charge by the number of shifts the position
 * survived, the same failure mode that grew walkingPnl to 31,376 entries
 * against a true ceiling of 251.
 *
 * The half-open interval is what keeps it exact: Binance settles on the
 * hour and 15m candles also land on the hour, so a closed interval on
 * both ends would double-charge EVERY settlement, not a rare edge case.
 */
function accrueFunding(previousSimTime: number, currentSimTime: number) {
    if (!(currentSimTime > previousSimTime)) return;

    for (const [symbol, state] of symbolStates) {
        const position = state.openPosition;
        if (!position || position.status !== 'OPEN') continue;
        if (!state.fundingRates.length || !state.window.length) continue;

        const candle = state.window[state.window.length - 1];
        const quantity = positionQuantity(position.margin, position.leverage, position.entryPrice);

        const { charges, totalPaid } = accrueFundingForInterval({
            history: state.fundingRates,
            side: position.side,
            quantity,
            // Marked at this tick's close. Binance uses the mark price at
            // the settlement instant; the tick close is the closest thing
            // this simulation knows without fetching a separate mark
            // series, and at a 15m granularity the difference is small
            // relative to the rate itself.
            priceAtSettlement: candle.close,
            afterTime: previousSimTime,
            untilTime: currentSimTime,
        });

        if (!charges.length) continue;

        position.fundingPaid += totalPaid;
        stats.value.totalFundingPaid += totalPaid;
        for (const c of charges) {
            fundingChargeLog.value.push({
                symbol, fundingTime: c.fundingTime, fundingRate: c.fundingRate,
                notional: c.notional, amount: c.amount, side: position.side,
            });
        }
    }
}

/** Every liquidation event, for the export. */
interface LiquidationEvent {
    timestamp: number;
    marginBalance: number;
    maintenanceMargin: number;
    positionsClosed: number;
    realizedPnl: number;
}
const liquidationEvents = ref<LiquidationEvent[]>([]);
const wasLiquidated = ref(false);
/** Balance fell below the smallest fundable position with nothing open -
 *  terminal, but NOT a liquidation. Kept separate so the two are never
 *  conflated when reading a result. */
const accountDied = ref(false);
/** "positionEntry only" mode stops the run once the free balance goes below zero. */
const balanceWentNegative = ref(false);

/**
 * Cross-margin liquidation check: when margin balance falls to or below
 * total maintenance margin, the exchange closes EVERYTHING and the
 * account is done.
 *
 * Previously maintenance margin was computed and DISPLAYED but never
 * acted on - so a run whose equity went negative kept trading and
 * reported a recovery that could not have happened. Every figure past
 * that point was fiction. This ends the run there, which is what a real
 * account does.
 *
 * Both sides are computed fresh rather than read from the once-per-tick
 * computeds, for the same reason computeCurrentOpenPnl exists: those
 * still hold the PREVIOUS tick's values at the moment this has to decide.
 */
function checkLiquidation(currentSimTime: number): boolean {
    let openPnl = 0;
    let marginUsed = 0;
    let maintenance = 0;
    let openCount = 0;

    for (const [symbol, state] of symbolStates) {
        const position = state.openPosition;
        if (!position || position.status !== 'OPEN') continue;
        if (!state.window.length) continue;
        const candle = state.window[state.window.length - 1];
        openPnl += markToMarketPnl(position, candle.close);
        marginUsed += position.margin;
        maintenance += BinanceMarginUtility.calculateMaintenanceMargin(symbol, position.margin * position.leverage);
        openCount++;
    }

    if (!openCount) return false;

    const freeBalance = (startingBalance.value
        - (marginUsed + stats.value.totalTakerFee + stats.value.totalFundingPaid))
        + stats.value.totalClosedPnl;
    const equity = freeBalance + marginUsed + openPnl;

    if (equity > maintenance) return false;

    // Liquidated. Close everything at this candle's close, charging the
    // exit fee like any other fill. A real liquidation costs MORE than
    // this (liquidation fee plus slippage into a falling book), so this
    // remains the optimistic end of the range.
    let realized = 0;
    for (const [, state] of symbolStates) {
        if (!state.openPosition || state.openPosition.status !== 'OPEN') continue;
        if (!state.window.length) continue;
        const closeGi = state.window.length - 1;
        forceClosePosition(state.openPosition, state.window[closeGi], closeGi, 'LIQUIDATED');
        realized += state.openPosition.pnl ?? 0;
        state.openPosition = null;
    }

    liquidationEvents.value.push({
        timestamp: currentSimTime,
        marginBalance: equity,
        maintenanceMargin: maintenance,
        positionsClosed: openCount,
        realizedPnl: realized,
    });
    wasLiquidated.value = true;
    return true;
}

/** Shared leveraged mark-to-market formula - one definition so the
 *  auto-close check and recordTick can never drift apart. */
function markToMarketPnl(position: PositionEntry, close: number): number {
    const pnlPercent = ((close - position.entryPrice) / position.entryPrice)
        * (position.side === 'LONG' ? 1 : -1) * position.leverage;
    return position.margin * pnlPercent;
}

/**
 * Total open pnl across every symbol, computed FRESH from each window's
 * current last candle.
 *
 * Deliberately not reading stats.totalOpenPnl: that's written by
 * recordTick, which runs AFTER the auto-close check for this same tick,
 * so it still holds the PREVIOUS tick's value at the moment a pnl rule
 * needs to decide. A pnl rule reading it would fire one tick late,
 * against a number that no longer describes the book.
 */
function computeCurrentOpenPnl(): number {
    let total = 0;
    for (const [, state] of symbolStates) {
        if (!state.window.length) continue;
        const candle = state.window[state.window.length - 1];
        const position = candle.positionEntry;
        if (!position || position.status !== 'OPEN') continue;
        total += markToMarketPnl(position, candle.close);
    }
    return total;
}

/**
 * Whether ONE rule triggers on this tick.
 *
 * DAILY_TIME fires once per day, on whichever 15-minute tick lands in the
 * same bucket as the configured time (comparing exact millisecond
 * timestamps would almost never match, since the configured time isn't
 * necessarily aligned to a 15-minute boundary).
 *
 * EVERY_N_DAYS/HOURS are elapsed-time based from when THIS rule last
 * fired (or from the first tick it was evaluated on, for the first
 * interval).
 *
 * The two OPEN_PNL rules are level checks, not crossing checks - they ask
 * "is open pnl at or past this threshold right now". They need no
 * cooldown because firing closes the whole book, which drops open pnl to
 * 0; they can only fire again once new positions have opened and drifted
 * back past the threshold. Note the consequence: a rule can fire on the
 * very first tick after positions reopen if pnl is already past the
 * level, which is correct behavior but worth knowing when reading a run.
 */
function ruleTriggers(rule: AutoCloseRule, currentSimTime: number, currentOpenPnl: number): boolean {
    switch (rule.type) {
        case 'OPEN_PNL_ABOVE':
            return currentOpenPnl >= rule.pnlThreshold;

        case 'OPEN_PNL_BELOW':
            return currentOpenPnl <= rule.pnlThreshold;

        case 'DAILY_TIME': {
            const hour24 = rule.dailyAmPm === 'AM'
                ? (rule.dailyHour % 12)
                : (rule.dailyHour % 12) + 12;
            const targetMinuteOfDay = hour24 * 60 + rule.dailyMinute;
            const date = new Date(currentSimTime);
            const currentMinuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
            return Math.floor(currentMinuteOfDay / 15) === Math.floor(targetMinuteOfDay / 15);
        }

        case 'EVERY_N_DAYS':
        case 'EVERY_N_HOURS': {
            const last = ruleLastFiredAt.get(rule.id);
            if (last == null) {
                // First evaluation - start this rule's clock now rather
                // than firing immediately against an epoch-zero baseline.
                ruleLastFiredAt.set(rule.id, currentSimTime);
                return false;
            }
            const elapsedMs = currentSimTime - last;
            const intervalMs = rule.type === 'EVERY_N_DAYS'
                ? rule.everyNDays * 24 * 60 * 60 * 1000
                : rule.everyNHours * 60 * 60 * 1000;
            return intervalMs > 0 && elapsedMs >= intervalMs;
        }
    }
}

/**
 * Every enabled rule that triggers on this tick. All are returned, not
 * just the first - the close happens once regardless, but recording ALL
 * the rules that fired is what makes an exported run analyzable ("the
 * pnl rule and the 4-hour rule coincided here" is a different fact from
 * either alone).
 */
function triggeredAutoCloseRules(currentSimTime: number, currentOpenPnl: number): AutoCloseRule[] {
    const fired: AutoCloseRule[] = [];
    for (const rule of autoCloseRules.value) {
        if (!rule.enabled) continue;
        if (ruleTriggers(rule, currentSimTime, currentOpenPnl)) fired.push(rule);
    }
    return fired;
}

/** One-line human description of a rule, for the UI and the export. */
function describeAutoCloseRule(rule: AutoCloseRule): string {
    switch (rule.type) {
        case 'DAILY_TIME': return `daily at ${rule.dailyHour}:${String(rule.dailyMinute).padStart(2, '0')} ${rule.dailyAmPm} UTC`;
        case 'EVERY_N_DAYS': return `every ${rule.everyNDays} day(s)`;
        case 'EVERY_N_HOURS': return `every ${rule.everyNHours} hour(s)`;
        case 'OPEN_PNL_ABOVE': return `open PNL >= ${rule.pnlThreshold} USDT`;
        case 'OPEN_PNL_BELOW': return `open PNL <= ${rule.pnlThreshold} USDT`;
    }
}


/**
 * Force-closes every currently open position, across every symbol, at
 * whatever each is worth on its own most recent candle. A blunt,
 * portfolio-wide safety valve, distinct from the per-position duration
 * cap - that one is per-position and unconditional; this is scheduled and
 * applies to everything open at once. Must run BEFORE recordTick for this
 * same tick, so the forced closes get correctly folded into this tick's
 * own stats/snapshot rather than the next one.
 */
function autoCloseAllPositions(currentSimTime: number, firedRules: AutoCloseRule[], openPnlAtTrigger: number) {
    let closed = 0;
    for (const [, state] of symbolStates) {
        if (!state.openPosition || state.openPosition.status !== 'OPEN') continue;
        if (!state.window.length) continue;
        const closeGi = state.window.length - 1;
        const closingCandle = state.window[closeGi];
        // AUTO_CLOSE, not EXPIRED: both are force-closes, but they
        // answer different questions - "is the candle-life cap set
        // right" vs "what did the scheduled flatten cost". Lumping them
        // would silently inflate the Expired column whenever an
        // auto-close mode is on.
        forceClosePosition(state.openPosition, closingCandle, closeGi, 'AUTO_CLOSE');
        // Must clear this, or the NEXT shift would try to resume an
        // already-closed position (treating it as still open) instead
        // of correctly seeing this symbol's slot as vacant again.
        state.openPosition = null;
        closed++;
    }

    // Reset the elapsed clock for EVERY elapsed-time rule, not only the
    // ones that fired: the book is now flat, so an "every 4 hours" rule
    // that didn't fire this tick should still measure its next interval
    // from this flatten, not from a stale earlier one.
    for (const rule of autoCloseRules.value) {
        if (rule.type === 'EVERY_N_DAYS' || rule.type === 'EVERY_N_HOURS') {
            ruleLastFiredAt.set(rule.id, currentSimTime);
        }
    }

    autoCloseEvents.value.push({
        timestamp: currentSimTime,
        openPnlAtTrigger,
        positionsClosed: closed,
        ruleIds: firedRules.map(r => r.id),
        ruleDescriptions: firedRules.map(describeAutoCloseRule),
    });
}

async function runRollingSimulation() {
    resetRun();
    isRunning.value = true;
    stopRequested = false;

    const startTimestamp = new Date(startDateTimeInput.value).getTime();
    runStartTimestamp = startTimestamp;
    const parsedEnd = endDateTimeInput.value ? new Date(endDateTimeInput.value).getTime() : NaN;
    runEndTimestamp = Number.isFinite(parsedEnd) ? parsedEnd : null;
    if (runEndTimestamp != null && runEndTimestamp <= startTimestamp) {
        statusMessage.value = 'end date must be after the start date';
        isRunning.value = false;
        return;
    }
    archiveError.value = null;
    archiveEnabled.value = true;
    archiveRawCandles.value = 0;
    archiveSignalCandles.value = 0;
    archiveBuffer.clear();
    archiveBufferedRows = 0;
    try {
        // CLOSE THE PREVIOUS RUN'S CONNECTION FIRST. Leaving it open is what
        // makes a reopen block, and a blocked open used to wait forever.
        if (archiveDb) { archiveDb.close(); archiveDb = null; }
        // Every step reports. All of them can take real time on a store holding
        // over a million rows, and this runs before the init loop starts
        // talking - a silent pause with the run button disabled is
        // indistinguishable from a crash, which is how this was found.
        statusMessage.value = 'opening run archive…';
        await new Promise(resolve => setTimeout(resolve, 0));
        archiveDb = await openArchiveDb();
        // A run owns the archive outright. Leaving the previous run's candles
        // in place would produce an export mixing two runs - the kind of file
        // that looks complete and is not.
        statusMessage.value = 'clearing the previous run archive…';
        await new Promise(resolve => setTimeout(resolve, 0));
        await clearArchive(archiveDb);
        await putMeta(archiveDb, 'run', {
            startedAt: Date.now(), from: startTimestamp, to: runEndTimestamp,
        });
        statusMessage.value = 'archive ready';
    } catch (e) {
        // The archive is a recording of the experiment, not the experiment.
        // Its failure is reported and the run carries on without it.
        if (archiveDb) { try { archiveDb.close(); } catch { /* already gone */ } }
        archiveDb = null;
        archiveEnabled.value = false;
        archiveError.value = e instanceof Error ? e.message : String(e);
        statusMessage.value = `archive unavailable (${archiveError.value}) — running without it`;
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    runStartRealTimeMs = Date.now();
    candlesProcessedSoFar = 0;

    const symbols = chocoMintoStore.futureSymbols.map((s: any) => s.symbol);

    // No seeding needed for the initialization pass: it opens no
    // positions (see initializeSymbol). The main loop below refreshes
    // both running totals at the start of every tick.

    try {
        // PARALLEL INITIALIZATION. A fixed pool of workers pulls from one
        // shared cursor, so at most initConcurrencyInput fetches are ever in
        // flight and a slow symbol holds up only its own worker.
        //
        // Results are collected by ROSTER INDEX and committed afterwards in
        // that same order - never in completion order. See initializeSymbol's
        // own comment: symbolStates is iterated in insertion order by the main
        // tick loop, and each tick is a race for the last budget and cap
        // slots, so completion order would decide which symbols get filled and
        // two runs with identical settings would disagree.
        //
        // A worker that throws rejects the whole init, which is what the
        // sequential version did too. The remaining in-flight fetches cannot
        // be cancelled and will settle unobserved; nothing is committed.
        const concurrency = Math.max(1, Math.min(Math.floor(initConcurrencyInput.value) || 1, 16));
        const initialized = new Array<InitializedSymbol | null>(symbols.length).fill(null);
        let nextSymbolIndex = 0;
        let initializedCount = 0;

        const initStartedAt = performance.now();
        const initWorker = async (): Promise<void> => {
            while (true) {
                if (stopRequested) return;
                const i = nextSymbolIndex++;
                if (i >= symbols.length) return;
                initialized[i] = await initializeSymbol(symbols[i], startTimestamp);
                initializedCount++;
                // Progress is a COUNT, not the roster index - with workers
                // running concurrently there is no single "current" symbol,
                // and showing one worker's index would jump around.
                statusMessage.value = `initializing: ${initializedCount}/${symbols.length} (${concurrency} at a time)`;
                // Hand the browser a turn. Each initializeSymbol ends in a
                // full 500-candle analysis pass, which is synchronous CPU
                // work; without this the tab locks up for the whole init.
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        };

        await Promise.all(Array.from({ length: concurrency }, initWorker));
        timeInitMs = performance.now() - initStartedAt;
        if (stopRequested) return;

        for (const entry of initialized) {
            if (!entry) continue;
            symbolStates.set(entry.symbol, entry.state);
            if (entry.coverage) fundingCoverage.set(entry.symbol, entry.coverage);
            // The warm-up window is fully analysed by initializeSymbol, so
            // every one of its candles carries derived fields. Archived here
            // rather than inside initializeSymbol so the archive is written in
            // roster order too, and so a parallel worker never touches it.
            archiveCandles(entry.symbol, entry.state.window.map((c, i) => compactCandle(c, entry.state.window, i)));
        }
        // Mirrors symbolStates, which is a plain Map and therefore invisible to
        // Vue - see symbolsLoaded's own note.
        symbolsLoaded.value = symbolStates.size;
        statusMessage.value = `archiving warm-up windows for ${symbolStates.size} symbols…`;
        await new Promise(resolve => setTimeout(resolve, 0));
        await flushArchive(true);

        // DATE-WINDOW CHECK, AT INITIALIZATION.
        //
        // Binance returns a symbol's EARLIEST available klines when the requested
        // start precedes its listing - no error, 500 valid candles from a
        // different calendar period. The post-run audit in the integrity block
        // reports this after the fact; this reports it BEFORE the walk starts,
        // which is when it can still be acted on. Found by auditing which exports
        // nothing imports: checkWindowIntegrity was written and then never called,
        // so every run so far discovered the leak only in its own export.
        //
        // REPORTS, does not exclude. A silent drop is how the problem arrived.
        windowIntegrityReport.value = checkWindowIntegrity(
            Array.from(symbolStates.entries())
                .filter(([, st]) => st.window.length > 0)
                .map(([symbol, st]) => ({
                    symbol,
                    firstOpenTime: st.window[0].openTime,
                    lastOpenTime: st.window[st.window.length - 1].openTime,
                    candleCount: st.window.length,
                })),
            {
                startMs: runStartTimestamp,
                // The WARM-UP window ends at the start timestamp, so a symbol is
                // judged on whether its history REACHES the range, not on whether
                // it stays inside it - the walk has not happened yet.
                endMs: Number.POSITIVE_INFINITY,
            }
        );
        if (!windowIntegrityReport.value.clean) {
            statusMessage.value = `WINDOW LEAK: ${windowIntegrityReport.value.excludeSymbols.length} symbols `
                + `have no data in the requested range and were served a different period `
                + `(${windowIntegrityReport.value.counts.LATE_START} more start late). `
                + `Their trades will be outside the window — see integrity.positionWindow.`;
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Which symbols could NOT be priced for funding. Surfaced rather
        // than left implicit: a symbol with no funding history is charged
        // 0, and 0 is indistinguishable from "genuinely free" unless the
        // gap is named.
        fundingSymbolsMissing.value = Array.from(symbolStates.entries())
            .filter(([, st]) => st.window.length > 0 && st.fundingRates.length === 0)
            .map(([sym]) => sym);

        const settledKeys = new Set<string>();

        // Record the initial 500-candle window's own history FIRST -
        // without this, the log silently starts at candle 501 (the
        // first one added by a shift), skipping the entire requested
        // start date. candlesProcessedSoFar counts these too, so the
        // main loop's clock formula below doesn't need a separate
        // WINDOW_SIZE offset.
        for (let i = 0; i < WINDOW_SIZE; i++) {
            if (stopRequested) break;
            const tickTimestamp = startTimestamp + i * FIFTEEN_MIN_MS;
            recordTick(tickTimestamp, settledKeys, i);
            candlesProcessedSoFar++;
            if (i % 50 === 0) {
                statusMessage.value = `recording initial window: candle ${i + 1}/${WINDOW_SIZE}`;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        while (!stopRequested) {
            // Pause gate. Parked here, the whole walk is suspended with
            // every symbol's state intact - which is what makes it safe to
            // open the chart inspector or download the windows mid-run.
            await waitWhilePaused();
            if (stopRequested) break;

            // The authoritative clock - derived purely from the requested
            // start time and how many ticks have elapsed, NEVER from any
            // individual symbol's own fetched data. A symbol with
            // incomplete early history would otherwise drag the entire
            // simulation's displayed/recorded time forward from the very
            // first tick. candlesProcessedSoFar already includes the
            // initial window's own 500 candles.
            const currentSimTime = startTimestamp + candlesProcessedSoFar * FIFTEEN_MIN_MS;
            // The previous tick's own clock value, for the half-open
            // funding window (previous, current]. Derived from the same
            // authoritative formula rather than remembered in a variable,
            // so it cannot drift out of step with the clock.
            const previousSimTime = currentSimTime - FIFTEEN_MIN_MS;

            // Caught up to the current real-world moment - stop here
            // rather than spinning forever waiting for candles that
            // haven't happened yet.
            if (currentSimTime >= Date.now() - FIFTEEN_MIN_MS) {
                statusMessage.value = 'caught up to current time — run complete';
                break;
            }
            // RANGE RUN. Checked against the authoritative clock, never
            // against any symbol's own data, for the same reason the clock
            // itself is derived that way: one symbol with short history would
            // otherwise decide where the range ends.
            if (runEndTimestamp != null && currentSimTime > runEndTimestamp) {
                statusMessage.value = `reached the end of the requested range — run complete`;
                break;
            }

            // Refresh the running budget to the most recently known
            // balance before processing this tick's own symbols - see
            // remainingBudgetThisTick's own comment for why this has to
            // be a fresh, per-tick running total rather than just reading
            // `balance` directly inside each symbol's own gate check.
            remainingBudgetThisTick = balance.value;
            openPositionCountThisTick = openPositionsDisplay.value.length;
            // Frozen here too, before any symbol is touched. Free cash plus
            // committed margin - it does not move as this tick's positions
            // open, which is what keeps the cap stable while the count grows.
            realizedEquityThisTick = balance.value + estimatedMarginUsed.value;
            // Frozen here, before any symbol is touched - see marginThisTick.
            marginThisTick = effectiveMargin.value;
            enforcedCapThisTick = currentCapThisTick();

            // Top up every empty staging buffer in one parallel pass, so the
            // symbol loop below never blocks on the network. Returns
            // immediately when nothing needs refilling, which is every tick
            // except one in STAGING_FETCH_SIZE.
            await refillStagingBuffers();
            if (stopRequested) break;
            const tickStartedAt = performance.now();
            // Non-blocking. Starts refills for buffers running low so their
            // next batch has already landed by the time they would run dry.
            schedulePrefetch();

            // The balance rule accounts per UTC day, because the quantity it
            // neutralises is the day's drift. Rolled BEFORE any symbol is
            // processed so every candidate this tick is measured against the same
            // day's counts.

            let anyAdvanced = false;
            let symbolsAdvancedThisTick = 0;
            for (const [symbol, state] of symbolStates) {
                if (stopRequested) break;
                if (state.exhausted) continue;
                const advanced = await shiftSymbolWindow(symbol, state);
                if (advanced) anyAdvanced = true;
                symbolsAdvancedThisTick++;

                // shiftSymbolWindow's real work (re-running analysis on
                // the shifted window) is synchronous - it only awaits a
                // network fetch when the staging buffer is empty, which
                // is most of the time NOT the case. Without an explicit
                // yield here, a full pass over all symbols runs as one
                // unbroken synchronous block with no chance for the
                // browser to repaint or respond.
                if (symbolsAdvancedThisTick % Math.max(1, yieldEverySymbols.value) === 0) {
                    const candleDatePht = new Date(currentSimTime).toLocaleString('en-US', { timeZone: 'Asia/Manila' });
                    statusMessage.value = `candle ${candlesProcessedSoFar + 1} (${candleDatePht} PHT): symbol ${symbolsAdvancedThisTick}/${symbolStates.size} [${symbol}]`;
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            if (!anyAdvanced) {
                statusMessage.value = 'no further data available from any symbol — stopping';
                break;
            }

            // ORDER MATTERS. Funding first: it is a cash cost that has
            // already been settled by this moment, so it must be in the
            // balance before anything reads equity. Then liquidation,
            // which is checked against that post-funding equity - funding
            // can itself be what tips an account under maintenance.
            // Auto-close rules are only consulted if the account survived.
            accrueFunding(previousSimTime, currentSimTime);

            if (!mimicRunSimulation.value && checkLiquidation(currentSimTime)) {
                candlesProcessedSoFar++;
                recordTick(currentSimTime, settledKeys);
                statusMessage.value = `LIQUIDATED at ${new Date(currentSimTime).toLocaleString()} — margin balance fell to maintenance margin. Run stopped.`;
                break;
            }

            // CROSS-SECTIONAL REBALANCE. Placed here deliberately: after the
            // shift loop (every window is at this candle), after funding (a
            // position opened now was not open for a settlement already past)
            // and after liquidation (that test must see the book as it was
            // DURING the tick), but before recordTick (which reads each
            // symbol's last candle for a positionEntry). See
            // rebalanceCrossSection's own note.

            // Open pnl computed fresh here, not read from stats - see
            // computeCurrentOpenPnl for why that distinction matters.
            const openPnlNow = computeCurrentOpenPnl();
            const firedRules = mimicRunSimulation.value ? [] : triggeredAutoCloseRules(currentSimTime, openPnlNow);
            if (firedRules.length) {
                autoCloseAllPositions(currentSimTime, firedRules, openPnlNow);
            }

            candlesProcessedSoFar++;
            recordTick(currentSimTime, settledKeys);
            timeWalkMs += performance.now() - tickStartedAt;

            // ACCOUNT DEAD, though not liquidated. With nothing open and a
            // balance below the smallest fundable position, the budget check
            // rejects every entry and no open position can ever return
            // capital - so every remaining tick is guaranteed to be a no-op.
            // One real run spent 777 ticks in exactly this state, which reads
            // as a flat tail and wastes the rest of the walk. Distinct from
            // liquidation: nothing was force-closed, the account simply bled
            // out through ordinary stops.
            // "positionEntry only" mode has no liquidation or budget check, so
            // it stops here instead: a negative free balance means the account
            // could not have held these positions.
            if (mimicRunSimulation.value && balance.value < 0) {
                balanceWentNegative.value = true;
                statusMessage.value = `BALANCE NEGATIVE at ${new Date(currentSimTime).toLocaleString()} — `
                    + `balance ${balance.value.toFixed(2)} with ${openPositionsDisplay.value.length} open `
                    + `(margin ${estimatedMarginUsed.value.toFixed(2)}, open pnl ${stats.value.totalOpenPnl.toFixed(2)}). Run stopped.`;
                break;
            }

            if (!mimicRunSimulation.value && openPositionsDisplay.value.length === 0 && balance.value < effectiveMargin.value) {
                accountDied.value = true;
                statusMessage.value = `ACCOUNT DEAD at ${new Date(currentSimTime).toLocaleString()} — `
                    + `balance ${balance.value.toFixed(2)} cannot fund the minimum position `
                    + `(${effectiveMargin.value}) and nothing is open. Not a liquidation; run stopped.`;
                break;
            }

            if (isPaused.value) {
                statusMessage.value = `paused at ${new Date(currentSimTime).toLocaleString()} — ${candlesProcessedSoFar} candles processed`;
            } else if (candlesProcessedSoFar % 5 === 0) {
                completionEstimateDisplay.value = estimateCompletion(runStartTimestamp, runStartRealTimeMs, candlesProcessedSoFar);
                statusMessage.value = `running — ${candlesProcessedSoFar} candles processed`;
            }
        }
    } finally {
        // Whatever ended the walk - range end, stop, liquidation, error - the
        // buffered tail is written before the run is marked finished.
        //
        // AWAITED. As fire-and-forget this raced a download taken seconds
        // later: one real run reported 519,900 rows in run-meta.json while
        // 1,196,160 had actually been written. The files were complete, because
        // the per-symbol reads ran after the writes landed - only the count was
        // wrong, which is the worse of the two failures, since it makes a good
        // archive look truncated.
        await flushArchive(true);
        isRunning.value = false;
        isPaused.value = false;
        resumeResolver = null;
        stepRequested = false;
        if (stopRequested) statusMessage.value = 'stopped';
    }
}

// ── Dashboard summary ────────────────────────────────────────────────────
// Computed ON DEMAND, never as a computed property. A full run is ~23,000
// snapshots and ~15,000 positions; the summary sorts those several times
// over, so recomputing it reactively would do that work on every one of
// those 23,000 ticks. It's refreshed when the Dashboard tab is opened,
// when the refresh button is pressed, and when a result is exported.
const dashboardSummary = ref<SimulationSummary | null>(null);

function refreshDashboard() {
    dashboardSummary.value = buildSimulationSummary(
        snapshots.value,
        resolvedPositionsLog.value,
        { startingBalance: startingBalance.value, partial: isRunning.value }
    );
}

// Refresh on entering the tab so it never shows a stale picture from
// thousands of ticks ago without saying so.
watch(selectedTab, (tab) => {
    if (tab === 'Dashboard') refreshDashboard();
});

function fmt(value: number | null | undefined, digits = 2): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toFixed(digits);
}

function fmtPercent(value: number | null | undefined, digits = 1): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return `${(value * 100).toFixed(digits)}%`;
}

function fmtTime(ts: number | null | undefined): string {
    if (ts == null) return '—';
    return new Date(ts).toLocaleString();
}

/** Equity curve as an SVG polyline in a fixed 0-100 x 0-100 viewBox, so
 *  the chart scales with its container without recomputing on resize. */
const equityPolyline = computed(() => {
    const curve = dashboardSummary.value?.equityCurve ?? [];
    if (curve.length < 2) return '';
    let lo = Infinity, hi = -Infinity;
    for (const p of curve) {
        if (p.equity < lo) lo = p.equity;
        if (p.equity > hi) hi = p.equity;
    }
    const span = hi - lo || 1;
    return curve.map((p, i) => {
        const x = (i / (curve.length - 1)) * 100;
        const y = 100 - ((p.equity - lo) / span) * 100;
        return `${x.toFixed(3)},${y.toFixed(3)}`;
    }).join(' ');
});

/** Where the starting balance sits on the same 0-100 scale, so the curve
 *  can show a break-even line - the most useful single reference on it.
 *  null when it falls outside the plotted range (don't draw it). */
const breakEvenY = computed(() => {
    const curve = dashboardSummary.value?.equityCurve ?? [];
    const start = dashboardSummary.value?.startingBalance;
    if (curve.length < 2 || start == null) return null;
    let lo = Infinity, hi = -Infinity;
    for (const p of curve) {
        if (p.equity < lo) lo = p.equity;
        if (p.equity > hi) hi = p.equity;
    }
    if (start < lo || start > hi) return null;
    const span = hi - lo || 1;
    return 100 - ((start - lo) / span) * 100;
});

// ── Excursion chart geometry ─────────────────────────────────────────────
// Plotted in a FIXED pixel viewBox with preserveAspectRatio left at its
// default, unlike the equity curve's stretched 0-100 box: a scatter has
// two real axes in the same unit (ATR), so non-uniform scaling would both
// distort the MFE=MAE diagonal and turn every dot into an ellipse.
const SCATTER = { w: 440, h: 320, left: 44, right: 12, top: 14, bottom: 34 };

const scatterGeometry = computed(() => {
    const ex = dashboardSummary.value?.excursions;
    if (!ex || !ex.scatter.length) return null;

    const plotW = SCATTER.w - SCATTER.left - SCATTER.right;
    const plotH = SCATTER.h - SCATTER.top - SCATTER.bottom;
    // Pad the axes so points sitting exactly at the max aren't clipped
    // in half by the plot edge.
    const xMax = ex.maxMae > 0 ? ex.maxMae * 1.05 : 1;
    const yMax = ex.maxMfe > 0 ? ex.maxMfe * 1.05 : 1;

    const toX = (mae: number) => SCATTER.left + (mae / xMax) * plotW;
    const toY = (mfe: number) => SCATTER.top + plotH - (mfe / yMax) * plotH;

    // The MFE = MAE diagonal. Above it a trade went further in your
    // favour than against you; below it, the reverse. Drawn only across
    // the range where both axes actually reach.
    const diagMax = Math.min(xMax, yMax);

    return {
        points: ex.scatter.map(p => ({ cx: toX(p.mae), cy: toY(p.mfe), won: p.won })),
        xMax, yMax,
        axisY: SCATTER.top + plotH,
        axisX: SCATTER.left,
        plotRight: SCATTER.left + plotW,
        plotTop: SCATTER.top,
        diag: { x1: toX(0), y1: toY(0), x2: toX(diagMax), y2: toY(diagMax) },
        xTicks: [0, 0.25, 0.5, 0.75, 1].map(f => ({ x: toX(xMax * f), label: (xMax * f).toFixed(1) })),
        yTicks: [0, 0.25, 0.5, 0.75, 1].map(f => ({ y: toY(yMax * f), label: (yMax * f).toFixed(1) })),
    };
});

/** Stacked win/loss bars for one histogram, scaled to its tallest bin. */
function histogramBars(bins: Array<{ from: number; to: number; winners: number; losers: number }>) {
    const peak = bins.reduce((m, b) => Math.max(m, b.winners + b.losers), 0);
    return bins.map((b, i) => ({
        key: i,
        from: b.from,
        to: b.to,
        winners: b.winners,
        losers: b.losers,
        total: b.winners + b.losers,
        // Percentages of the tallest bin, so the shape is readable
        // regardless of absolute trade count.
        winPercent: peak > 0 ? (b.winners / peak) * 100 : 0,
        lossPercent: peak > 0 ? (b.losers / peak) * 100 : 0,
    }));
}

const maeBars = computed(() => {
    const ex = dashboardSummary.value?.excursions;
    return ex ? histogramBars(ex.maeHistogram) : [];
});
const mfeBars = computed(() => {
    const ex = dashboardSummary.value?.excursions;
    return ex ? histogramBars(ex.mfeHistogram) : [];
});

function buildExportPayload() {
    return {
        exportedAt: Date.now(),
        // True when exported mid-run (paused or still walking) rather than
        // after the walk finished - so a partial export is never mistaken
        // for a completed one when analyzed later.
        partial: isRunning.value,
        pausedWhenExported: isPaused.value,
        startingBalance: startingBalance.value,
        startTimestamp: runStartTimestamp,
        candlesProcessed: candlesProcessedSoFar,
        lastSimTimestamp: snapshots.value.length ? snapshots.value[snapshots.value.length - 1].timestamp : null,
        // The settings that produced this run, so an exported result is
        // self-describing when analyzed later - otherwise comparing two
        // exports means guessing which parameters each was run with.
        settings: {
            startDateTimeInput: startDateTimeInput.value,
            windowSize: WINDOW_SIZE,
            // Also present at the payload's top level, kept there so
            // older readers of this format still find it. Duplicated here
            // so the settings block alone fully describes the run.
            startingBalance: startingBalance.value,
            margin: marginInput.value,
            useDynamicMargin: useDynamicMargin.value,
            marginStepBalance: marginStepBalance.value,
            marginStepAmount: marginStepAmount.value,
            marginFloor: marginFloorInput.value,
            marginCeiling: marginCeilingInput.value,
            positionCapRatio: positionCapRatioInput.value,
            positionCapFloor: positionCapFloorInput.value,
            positionCapCeiling: positionCapCeilingInput.value,
            maxPositionDurationCandles: maxPositionDurationInput.value,
            // Recorded because it affects wall-clock only, never results -
            // and having it in the file is what lets that claim be checked
            // rather than trusted.
            endDateTimeInput: endDateTimeInput.value,
            // Which entry produced the run. Absent from an export means the
            // run predates this flag, NOT that the entry was off - worth
            // knowing before comparing two files.
            initConcurrency: initConcurrencyInput.value,
            yieldEverySymbols: yieldEverySymbols.value,
            // Full rule objects plus a readable form of each, so an
            // export is interpretable without re-deriving the semantics.
            // Inactive parameter fields are present on every rule by
            // design - read only the ones the rule's type uses.
            autoCloseRules: autoCloseRules.value,
            autoCloseRuleDescriptions: autoCloseRules.value.map(r =>
                `${r.enabled ? '' : '(disabled) '}${describeAutoCloseRule(r)}`
            ),
            rosterHistoryLimit: ROSTER_HISTORY_LIMIT,
        },
        allKnownSymbols: chocoMintoStore.futureSymbols.map((s: any) => s.symbol),
        symbolsWithData: Array.from(symbolStates.entries()).filter(([, s]) => !s.exhausted || s.window.length > 0).map(([sym]) => sym),
        finalStats: { ...stats.value },
        finalBalance: {
            balance: balance.value,
            marginBalance: marginBalance.value,
            estimatedMarginUsed: estimatedMarginUsed.value,
            estimatedMaintenanceMargin: estimatedMaintenanceMargin.value,
            currentPositionCap: maxConcurrentPositionsInput.value,
        },
        resolvedPositions: resolvedPositionsLog.value,
        stillOpenPositions: openPositionsDisplay.value.map(row => ({
            symbol: row.symbol,
            openTime: row.openTime,
            side: row.position.side,
            entryPrice: row.position.entryPrice,
            sl: row.position.sl,
            tp: row.position.tp,
            margin: row.position.margin,
            leverage: row.position.leverage,
            entryFee: row.position.entryFee,
            fundingPaid: row.position.fundingPaid,
            mae: row.position.mae,
            mfe: row.position.mfe,
            maePrice: row.position.maePrice,
            mfePrice: row.position.mfePrice,
            atrAtEntry: row.position.atrAtEntry,
            currentPrice: row.currentPrice,
            markToMarketPnl: row.markToMarketPnl,
            walkingPnl: [...row.position.walkingPnl],
            entryReason: row.position.entryReason,
        })),
        // Rebuilt at export time rather than reusing whatever the
        // Dashboard last displayed, so the exported summary always
        // describes THIS payload's own snapshots/positions.
        // Funding actually charged, and what could be priced. A run that
        // could not price some symbols says so here instead of implying
        // full coverage.
        funding: {
            totalPaid: stats.value.totalFundingPaid,
            chargeCount: fundingChargeLog.value.length,
            symbolsWithoutData: fundingSymbolsMissing.value,
            coverage: Array.from(fundingCoverage.values()),
            // Bounded: a long run charges funding on many positions, and
            // the full log can be very large. The aggregate above is
            // complete; this is a sample for inspection.
            chargeSample: fundingChargeLog.value.slice(-5000),
        },
        // Engine self-checks. Both must be 0/true; anything else means the
        // run's own accounting cannot be trusted and says so in the file
        // rather than leaving it to be rediscovered by reconciliation.
        integrity: {
            unrecordedResolutions: unrecordedResolutionCount.value,
            skippedSymbolTicks: skippedSymbolTicks.value,
            analyzedSymbolTicks: analyzedSymbolTicks.value,
            skipRatio: (skippedSymbolTicks.value + analyzedSymbolTicks.value) > 0
                ? skippedSymbolTicks.value / (skippedSymbolTicks.value + analyzedSymbolTicks.value)
                : 0,
            maxOpenObserved: snapshots.value.reduce((m, s) => Math.max(m, s.open), 0),
            // A GENUINE breach is `open` GROWING beyond the cap the gate
            // enforced. `open` sitting above the forward-looking cap after a
            // losing stretch is benign - the cap shrinks with balance and
            // nothing force-closes an existing book to match it.
            capBreaches: snapshots.value.filter((s, i) =>
                i > 0 && s.open > s.enforcedCap && s.open > snapshots.value[i - 1].open
            ).length,
            ticksOpenAboveForwardCap: snapshots.value.filter(s => s.open > s.positionCap).length,
            // Candle-buffer prefetching. blockingRefills should be roughly one
            // per symbol - the unavoidable first tick - and flat after that.
            // A number that keeps climbing means the background task is not
            // keeping ahead and the run is still stalling on the network.
            // stagingGaps is NOT cosmetic: each entry is a symbol retired
            // because Binance returned a non-contiguous batch.
            archivedCandles: archiveRawCandles.value,
            archivedSignalCandles: archiveSignalCandles.value,
            archiveDisabledReason: archiveError.value,
            stagingBlockingRefills: stagingBlockingRefills.value,
            stagingPrefetches: stagingPrefetches.value,
            stagingGaps: stagingGaps.value,
            // Cross-sectional book. rebalances x 2 x pairs opened should equal
            // legsOpened exactly; any shortfall means the cap or the budget cut
            // the book, which is legal but changes what was measured.
            // The candle-level view, taken at initialization - which symbols were
            // served a different calendar period than the one asked for. Distinct
            // from positionWindow below, which is the same defect seen through the
            // trades it produced. The two can disagree, and a disagreement is
            // information: candles inside the range can still produce an
            // out-of-window position if a symbol's series has an internal gap.
            symbolWindows: windowIntegrityReport.value ? {
                counts: windowIntegrityReport.value.counts,
                excludeSymbols: windowIntegrityReport.value.excludeSymbols,
                clean: windowIntegrityReport.value.clean,
            } : null,
            // WALL CLOCK, in seconds. `analysis` is time inside runMarketAnalysis
            // and is the number to watch: it is the full 500-candle re-derivation,
            // run once per analysed symbol-tick. `walk` is the whole main loop, so
            // walk - analysis - fetch is everything else (funding, liquidation,
            // recordTick, archiving, yielding to the browser).
            timingSeconds: {
                init: +(timeInitMs / 1000).toFixed(1),
                walk: +(timeWalkMs / 1000).toFixed(1),
                analysis: +(timeAnalysisMs / 1000).toFixed(1),
                blockingFetch: +(timeFetchMs / 1000).toFixed(1),
                archiveFlush: +(timeArchiveMs / 1000).toFixed(1),
                crossSection: +(timeCrossSectionMs / 1000).toFixed(1),
                msPerAnalysedSymbolTick: analyzedSymbolTicks.value
                    ? +(timeAnalysisMs / analyzedSymbolTicks.value).toFixed(3) : 0,
                msPerCandle: candlesProcessedSoFar
                    ? +(timeWalkMs / candlesProcessedSoFar).toFixed(1) : 0,
            },
            // Funding charged to the account vs funding attributed to
            // individual positions. A gap means positions were mis-tracked.
            fundingChargedToAccount: stats.value.totalFundingPaid,
            fundingAttributedToPositions:
                resolvedPositionsLog.value.reduce((a, r) => a + r.fundingPaid, 0)
                + openPositionsDisplay.value.reduce((a, r) => a + r.position.fundingPaid, 0),
            // DATE-WINDOW LEAK. Binance returns a symbol's EARLIEST available
            // klines when the requested start precedes its listing, without
            // erroring - so a symbol listed in May was simulated over May while
            // the portfolio counted it as concurrent with January. The
            // 2026-09-26 export had 330 of 1,970 positions (16.8%) outside its
            // configured range, spread over six months, and they were the only
            // profitable cohort in the run.
            //
            // Nothing above notices this: funding accrues on each symbol's own
            // timestamps, so the funding reconciliation stays perfect. An
            // independent witness was needed, which is what this is.
            //
            // Reported, not fixed by exclusion. Dropping the symbols silently is
            // how the problem arrived; the caller decides.
            positionWindow: auditPositionWindows(
                resolvedPositionsLog.value.map(p => ({ symbol: p.symbol, openTime: p.openTime })),
                {
                    startMs: runStartTimestamp,
                    endMs: runEndTimestamp ?? Number.POSITIVE_INFINITY,
                }
            ),
        },
        liquidation: {
            liquidated: wasLiquidated.value,
            events: liquidationEvents.value,
            // A DIFFERENT terminal state: bled out below the minimum
            // position size rather than being force-closed at maintenance
            // margin. `liquidated: false` with `accountDied: true` means the
            // strategy simply lost the account through ordinary stops.
            accountDied: accountDied.value,
        },
        summary: buildSimulationSummary(
            snapshots.value,
            resolvedPositionsLog.value,
            { startingBalance: startingBalance.value, partial: isRunning.value }
        ),
        snapshots: snapshots.value,
        // The retained tail of per-tick position rosters, with the
        // snapshot index each belongs to. Bounded by ROSTER_HISTORY_LIMIT
        // - earlier ticks' rosters were dropped in memory and are genuinely
        // not recoverable, which rosterStartSnapshotIndex makes explicit
        // rather than leaving as an unexplained gap.
        // Every auto-close that actually fired: when, what open pnl
        // triggered it, how many positions it flattened, and which
        // rule(s) coincided.
        autoCloseEvents: autoCloseEvents.value,
        rosterStartSnapshotIndex: rosterBaseIndex,
        rosterHistory: rosterWindow,
    };
}

function exportResult() {
    const payload = buildExportPayload();
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateLabel = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `rolling-trade-simulation-${payload.partial ? 'partial-' : ''}${dateLabel}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

onUnmounted(() => {
    stopRequested = true;
    isPaused.value = false;
    releaseGate();
});

defineExpose({ buildExportPayload });
</script>

<style scoped>
.datetime-input {
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  border-radius: 5px;
  outline: none;
  transition: border-color 0.2s;
  border: 1px solid #e4e4e7;
}

.datetime-input:focus {
  border-color: #929292;
}

/* The whole panel is bounded, so the controls at the top stay reachable
   no matter how long the tables get. */
.rolling-root {
  max-height: 90vh;
  overflow-y: auto;
}

/* No longer the scroll container - .table-scroll below owns scrolling now.
   Two nested scrollers (this one AND the table's) is what made the sticky
   header impossible to place: `position: sticky` resolves against its
   NEAREST scrolling ancestor, so with the scroll living out here the
   header would stick to the panel edge rather than to the top of the
   table it belongs to. */
.replay-snap-wrapper {
  min-height: 0;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
}

.pager-label {
  font-size: 0.8rem;
  color: #6b7280;
  white-space: nowrap;
}

.action-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.5rem;
}

.settings-pane {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 0.75rem;
  align-items: flex-start;
}

.settings-group {
  min-width: 14rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.preset-bar {
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 0.6rem 0.7rem;
  background: #fafafa;
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.35rem;
}

.preset-select {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.85rem;
  padding: 0.2rem 0.35rem;
  border: 1px solid #d4d4d8;
  border-radius: 4px;
  background: #fff;
}

.preset-btn {
  flex: none;
  font-size: 0.8rem;
  padding: 0.22rem 0.6rem;
  border: 1px solid #d4d4d8;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.preset-btn:hover:not(:disabled) { background: #f4f4f5; }
.preset-btn:disabled { opacity: 0.45; cursor: default; }
.preset-danger:hover:not(:disabled) { background: #fef2f2; border-color: #fca5a5; color: #b91c1c; }

/* Drift is the one preset message that must not read as routine: it means the
   run is no longer the named configuration, which is exactly the thing a preset
   was picked to guarantee.

   TWO CLASSES, not one. `.hint` also sets a colour and is declared later in this
   stylesheet, so at equal specificity it won and the warning rendered in the same
   grey as every other note - which is precisely the failure it exists to avoid.
   Caught by rendering the panel, not by reading it. */
.hint.preset-drift { color: #b45309; }

/* The rule list needs the full row, not a column beside the others. */
.settings-wide {
  flex-basis: 100%;
  min-width: 100%;
}

.settings-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6b7280;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.85rem;
}

/* A checkbox row, which is the one field shape that must NOT stack.
   .settings-field is flex-direction: column, so a label with a checkbox in it
   put the text on one line and left the box on the next, stretched across the
   column and reading as centred. This class existed to fix exactly that and was
   applied to nothing - the markup used the bare .settings-field throughout. */
.settings-check {
  flex-direction: row;
  align-items: center;
  /* label left, control right, so the boxes line up down the column instead of
     sitting at a different x for every label length */
  justify-content: space-between;
  gap: 0.5rem;
  cursor: pointer;
  min-height: 1.4rem;
}

.settings-check input[type="checkbox"] {
  /* Without flex: none the box is a flex item and gets stretched by the row. */
  flex: none;
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  cursor: pointer;
}

.settings-check input[type="checkbox"]:disabled { cursor: default; }

/* Dim a row whose control is disabled, so "unavailable because its parent is
   off" is visible rather than inferred. Progressive: a browser without :has()
   simply does not dim, and nothing else changes. */
.settings-check:has(input:disabled) { opacity: 0.55; }

/* Sub-options under a parent toggle. The tree character carries the meaning;
   this just stops it reading as a sibling. */
.settings-sub {
  padding-left: 0.6rem;
}

.rule-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid #e4e4e7;
  border-radius: 6px;
  margin-bottom: 0.35rem;
}

.rule-desc {
  margin-left: auto;
  font-style: italic;
}

.rule-remove {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #dc2626;
  font-size: 0.9rem;
}

.rule-remove:disabled { opacity: 0.4; cursor: default; }

/* ── Live panel ────────────────────────────────────────────────────── */
.live-panel {
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 0.75rem;
  /* Tabular figures matter more here than anywhere else in the app: this
     panel rewrites itself on every 15-minute tick, and with proportional
     digits the numbers visibly jitter sideways as values change, which
     makes a running column genuinely hard to read. */
  font-variant-numeric: tabular-nums;
}

.live-danger { border-color: #dc2626; }

.live-headline { margin-bottom: 0.6rem; }

.live-headline-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
}

.live-headline-value {
  font-size: 1.6rem;
  font-weight: 600;
  line-height: 1.2;
}

.live-headline-sub { font-size: 0.75rem; color: #6b7280; }

.live-warning {
  padding: 0.35rem 0.5rem;
  border-radius: 5px;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.75rem;
  margin-bottom: 0.6rem;
}

.live-section {
  padding-top: 0.5rem;
  margin-top: 0.5rem;
  border-top: 1px solid #f4f4f5;
}

.live-section-title {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #9ca3af;
  margin-bottom: 0.25rem;
}

.live-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.82rem;
  line-height: 1.7;
}

.live-label { color: #4b5563; }
.live-hint { font-size: 0.68rem; color: #9ca3af; }
.live-value { font-weight: 600; white-space: nowrap; }
.live-muted { font-weight: 400; color: #6b7280; }

.cap-bar {
  height: 6px;
  border-radius: 3px;
  background: #f4f4f5;
  overflow: hidden;
  margin: 0.15rem 0 0.35rem;
}

.cap-bar-fill {
  height: 100%;
  background: #2563eb;
  transition: width 0.2s;
}

.cap-bar-fill.cap-full { background: #d97706; }

.live-foot { margin-top: 0.6rem; font-size: 0.7rem; }

/* ── Excursion charts ──────────────────────────────────────────────── */
.excursion-layout {
  display: grid;
  grid-template-columns: minmax(20rem, 1.3fr) minmax(16rem, 1fr);
  gap: 1rem;
  align-items: start;
}

.excursion-chart-wrap { min-width: 0; }

.excursion-chart {
  width: 100%;
  height: auto;
  background: #fafafa;
  border-radius: 4px;
}

.ex-grid { stroke: #e9e9ec; stroke-width: 1; }
.ex-axis { stroke: #9ca3af; stroke-width: 1; }
.ex-diag { stroke: #9ca3af; stroke-width: 1; stroke-dasharray: 4 3; }
.ex-tick { font-size: 8px; fill: #6b7280; }
.ex-axis-label { font-size: 9px; fill: #6b7280; }

/* Low opacity is doing real work: with thousands of points the DENSITY
   is the signal, and opaque dots would render the cloud as a solid blob
   with no visible concentration. */
.ex-dot { opacity: 0.4; }
.ex-win { fill: #16a34a; }
.ex-loss { fill: #dc2626; }

.ex-legend {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.72rem;
  color: #4b5563;
  padding-top: 0.3rem;
  flex-wrap: wrap;
}

.ex-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  vertical-align: -1px;
  margin-right: 0.2rem;
}

.ex-win-bg { background: #16a34a; }
.ex-loss-bg { background: #dc2626; }
.ex-diag-bg { background: repeating-linear-gradient(90deg, #9ca3af 0 3px, transparent 3px 6px); }

.excursion-side { min-width: 0; }

.hist {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 90px;
  padding: 0.25rem;
  background: #fafafa;
  border-radius: 4px;
}

.hist-col { flex: 1; height: 100%; display: flex; align-items: flex-end; }

/* Losers stacked under winners in every bin, so the two histograms and
   the scatter all use the same colour meaning. */
.hist-stack { width: 100%; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
.hist-win { background: #16a34a; width: 100%; }
.hist-loss { background: #dc2626; width: 100%; }

.hist-axis { display: flex; justify-content: space-between; padding-top: 0.15rem; }

.mt-sm { margin-top: 0.5rem; }

/* ── Dashboard ─────────────────────────────────────────────────────── */
.dash { padding: 0.75rem; }

.dash-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.dash-alert {
  padding: 0.5rem 0.75rem;
  border: 1px solid #dc2626;
  border-radius: 6px;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.kpi {
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
}

.kpi-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
}

.kpi-value {
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.3;
}

.kpi-sub { font-size: 0.72rem; color: #6b7280; }

.dash-panel {
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}

.equity-chart {
  width: 100%;
  height: 180px;
  display: block;
  background: #fafafa;
  border-radius: 4px;
}

/* vector-effect="non-scaling-stroke" on the shapes keeps these widths
   true despite the non-uniform viewBox scaling the chart relies on. */
.equity-line { fill: none; stroke: #2563eb; stroke-width: 1.5; }
.equity-breakeven { stroke: #9ca3af; stroke-width: 1; stroke-dasharray: 4 3; }

.dash-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.dash-table th {
  text-align: left;
  font-weight: 600;
  color: #6b7280;
  border-bottom: 1px solid #e4e4e7;
  padding: 0.3rem 0.4rem;
  white-space: nowrap;
}

.dash-table td {
  padding: 0.28rem 0.4rem;
  border-bottom: 1px solid #f4f4f5;
  white-space: nowrap;
}

.dash-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  gap: 1rem;
}

.link-btn {
  border: none;
  background: transparent;
  padding: 0;
  color: #2563eb;
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
}

.table-scroll {
  max-height: 62vh;
  overflow-y: auto;
  overflow-x: auto;
}

/* Sticky header. border-collapse: collapse drops a <th>'s own borders
   once it's sticky (collapsed borders belong to the table, not the cell,
   so they scroll away with it and the header ends up sitting on the rows
   with no separation). `separate` keeps the border on the cell itself. */
.table-scroll :deep(table) {
  border-collapse: separate;
  border-spacing: 0;
}

.table-scroll :deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 2;
  /* Opaque - the rows scroll UNDERNEATH a sticky header, so any
     transparency shows them through it. */
  background: #fff;
  box-shadow: inset 0 -1px 0 #e4e4e7;
}

.timeline-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  border-top: 1px solid #e4e4e7;
  border-bottom: 1px solid #e4e4e7;
}

.hint {
  font-size: 0.8rem;
  color: #6b7280;
}

/* The evidence behind a setting, collapsed.
   It belongs in the UI - it is what stops a threshold being changed on a hunch,
   and several of these say plainly that a number is arbitrary - but as always-on
   prose it buried the controls: the Run group rendered ~2,000px tall with six
   checkboxes in it. Collapsed, the panel is scannable and the argument is one
   click away. */
.settings-why {
  display: block;
  margin: -0.1rem 0 0.2rem;
  line-height: 1.45;
}

.settings-why > summary {
  cursor: pointer;
  list-style: none;
  color: #9ca3af;
  font-size: 0.75rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 0.1rem 0;
  user-select: none;
}

.settings-why > summary::-webkit-details-marker { display: none; }

.settings-why > summary::before {
  content: "▸ ";
  display: inline-block;
  transition: transform 0.12s ease;
}

.settings-why[open] > summary::before { content: "▾ "; }

.settings-why > summary:hover { color: #4b5563; }

.settings-why[open] {
  border-left: 2px solid #e4e4e7;
  padding-left: 0.55rem;
  margin-bottom: 0.5rem;
}

.live-tag { color: #16a34a; }
.review-tag { color: #d97706; }

.cursor-row {
  outline: 2px solid #d97706;
  outline-offset: -2px;
}

tbody tr { cursor: pointer; }

.symbol-chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.5rem;
}

.symbol-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  border: 1px solid #e4e4e7;
  background: #fff;
  cursor: pointer;
  font-size: 0.8rem;
  transition: border-color 0.15s, transform 0.05s;
}

.symbol-chip:hover { border-color: #929292; }
.symbol-chip:active { transform: translateY(1px); }

.chip-long { border-left: 4px solid #16a34a; }
.chip-short { border-left: 4px solid #dc2626; }
.chip-symbol { font-weight: 600; }
.chip-side { color: #6b7280; font-size: 0.7rem; }
.pnl-pos { color: #16a34a; }
.pnl-neg { color: #dc2626; }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #fff;
  border-radius: 8px;
  overflow: auto;
}

.inspect-modal {
  width: 96vw;
  height: 92vh;
  display: flex;
  flex-direction: column;
}

.inspect-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e4e4e7;
}

.close-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  font-size: 1rem;
  cursor: pointer;
}
</style>