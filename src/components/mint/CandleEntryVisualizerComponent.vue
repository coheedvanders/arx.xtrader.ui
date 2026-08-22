<template>
  <div class="candle-visualizer">
    <div class="controls">
      <label class="checkbox-label">
        <input 
          v-model="connectVolumeSpikesvSpikes" 
          type="checkbox"
        />
        <span>Connect volume spikes</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showVolume"
          type="checkbox"
        />
        <span>Show volume</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showOiBar"
          type="checkbox"
        />
        <span>Show OI bar</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showLongShortRatio"
          type="checkbox"
        />
        <span>Long/Short Ratio</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showEma"
          type="checkbox"
        />
        <span>Show EMA</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showMa"
          type="checkbox"
        />
        <span>Show MA</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showCrossTfEma"
          type="checkbox"
        />
        <span>Cross TF EMA</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showMultiTf1h"
          type="checkbox"
        />
        <span>1H Candles</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showMultiTf4h"
          type="checkbox"
        />
        <span>4H Candles</span>
      </label>

      <label class="checkbox-label">
        <input
          v-model="showMultiTf1d"
          type="checkbox"
        />
        <span>1D Candles</span>
      </label>

      <button
        v-if="multiTfScrubbedCount > 0"
        @click="multiTfBarOverrides = {}"
      >
        Reset Scrubbed Candles ({{ multiTfScrubbedCount }})
      </button>

      <button @click="showKeyLevels = true">show key levels</button>

      <button @click="showMaCrossing = true">See MA</button>

      <button @click="showAccumulationAnalysis = true">Accumulation Scan</button>

      <!-- ── Wallet Movement (exchange inflow/outflow) tool ──────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': showMovementPanel }"
        @click="fetchWalletMovement"
        title="Pulls exchange wallet inflow/outflow for this symbol across the visible candle range and plots it as a bar panel below the chart"
      >
        {{ movementLoading ? 'Loading Movement…' : 'See Movement' }}
      </button>

      <button
        v-if="showMovementPanel"
        class="tool-btn"
        @click="showMovementPanel = false"
      >
        Hide Movement
      </button>

      <!-- ── Volume Profile Fixed Range tool ─────────────────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': vpModeActive }"
        @click="toggleVpMode"
        title="Click to enable, then click-drag from one candle to another on the chart"
      >
        {{ vpModeActive ? 'Volume Profile: ON' : 'Volume Profile' }}
      </button>

      <button
        v-if="volumeProfiles.length > 0"
        class="tool-btn"
        @click="volumeProfiles = []"
      >
        Clear VP ({{ volumeProfiles.length }})
      </button>

      <button
        class="tool-btn"
        @click="fillPriceZonesWithVolumeProfile"
        title="Auto-place one Fixed-Range Volume Profile per Price Zone (replaces any currently placed VPs)"
      >
        Fill PZ VP
      </button>

      <button
        class="tool-btn"
        @click="fillVolumeSpikesWithVolumeProfile"
        title="Walk volume-spike candles oldest→newest and place a VP per confirmed swing leg; a bounce that gets fully retraced by a later spike doesn't get its own VP — it's absorbed back into the leg that was extending (replaces any currently placed VPs)"
      >
        VP Volume Spikes
      </button>

      <button
        v-if="volumeProfiles.length > 0"
        class="tool-btn"
        @click="downloadAllFrvpZip"
        title="Download every placed FRVP as a single zip (one JSON per profile + manifest + README)"
      >
        Download FRVPs ({{ volumeProfiles.length }})
      </button>

      <button
        v-if="volumeProfiles.length > 0"
        class="tool-btn"
        @click="runFrvpAnalysis"
        title="Run the confluence analyzer over every placed FRVP (oldest to newest) and show a LONG/SHORT/NEUTRAL read"
      >
        Analyze FRVPs
      </button>

      <!-- ── Anchored VWAP tool ──────────────────────────────────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': avwapModeActive }"
        @click="toggleAvwapMode"
        title="Click to enable, then click a candle to anchor a VWAP (with upper/lower stdev bands) from that candle forward"
      >
        {{ avwapModeActive ? 'Anchored VWAP: pick a candle…' : 'Anchored VWAP' }}
      </button>

      <button
        v-if="anchoredVwaps.length > 0"
        class="tool-btn"
        @click="anchoredVwaps = []"
      >
        Clear AVWAP ({{ anchoredVwaps.length }})
      </button>

      <label class="checkbox-label">
        <input
          v-model="showAvwapBands"
          type="checkbox"
        />
        <span>Show AVWAP Bands</span>
      </label>

      <div class="tool-dropdown" ref="pzAvwapDropdownRef">
        <button
          class="tool-btn"
          @click="pzAvwapDropdownOpen = !pzAvwapDropdownOpen"
          title="Auto-anchor one open-ended AVWAP at the start candle of each Price Zone (replaces any currently placed AVWAPs)"
        >
          Fill PZ AVWAP ▾
        </button>
        <div v-if="pzAvwapDropdownOpen" class="tool-dropdown-menu">
          <button
            class="tool-dropdown-item"
            @click="fillPriceZonesWithAvwap('recent'); pzAvwapDropdownOpen = false"
          >
            Past 6 zones
          </button>
          <button
            class="tool-dropdown-item"
            @click="fillPriceZonesWithAvwap('all'); pzAvwapDropdownOpen = false"
          >
            All zones
          </button>
        </div>
      </div>

      <!-- ── Range Download tool ─────────────────────────────────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': rangeDownloadModeActive }"
        @click="toggleRangeDownloadMode"
        title="Click to enable, then click-drag from one candle to another to select a range. A download button appears on the box - grabs OHLCV+EMA200, AVWAP points, FRVP (if any), OI and Long/Short Ratio per candle in that range."
      >
        {{ rangeDownloadModeActive ? 'Range Download: pick a range…' : 'Range Download' }}
      </button>

      <button
        v-if="rangeDownloadBoxes.length > 0"
        class="tool-btn"
        @click="rangeDownloadBoxes = []"
      >
        Clear Range Boxes ({{ rangeDownloadBoxes.length }})
      </button>

      <!-- ── Range Investigate tool ──────────────────────────────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': rangeInvestigateModeActive }"
        @click="toggleRangeInvestigateMode"
        title="Click to enable, then click-drag from one candle to another to select a range. An 'Investigate' button appears on the box - explains WHY that range moved the way it did (organic flow, squeeze/liquidation, single whale trade, or thin liquidity), factors in exchange inflow/outflow as supply-side confluence, and predicts continuation vs pullback vs reversal for the next price zone."
      >
        {{ rangeInvestigateModeActive ? 'Range Investigate: pick a range…' : 'Range Investigate' }}
      </button>

      <button
        v-if="rangeInvestigateBoxes.length > 0"
        class="tool-btn"
        @click="rangeInvestigateBoxes = []"
      >
        Clear Investigate Boxes ({{ rangeInvestigateBoxes.length }})
      </button>

      <!-- ── Summarize Movement tool ─────────────────────────────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': summarizeModeActive }"
        @click="toggleSummarizeMode"
        title="Click to enable, then click-drag from one candle to another to select a range. A 'Summarize' button appears on the box - totals exchange wallet inflow/outflow across that range and shows a per-candle horizontal bar chart breakdown in a dialog."
      >
        {{ summarizeModeActive ? 'Summarize Movement: pick a range…' : 'Summarize Movement' }}
      </button>

      <button
        v-if="summarizeBoxes.length > 0"
        class="tool-btn"
        @click="summarizeBoxes = []"
      >
        Clear Summarize Boxes ({{ summarizeBoxes.length }})
      </button>

      <!-- ── Freeform rectangle draw tool ──────────────────────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': rectModeActive }"
        @click="toggleRectMode"
        title="Click to enable, then click-drag anywhere on the chart to draw a rectangle"
      >
        {{ rectModeActive ? 'Rectangle: ON' : 'Rectangle' }}
      </button>

      <button
        v-if="drawnRectangles.length > 0"
        class="tool-btn"
        @click="drawnRectangles = []"
      >
        Clear Rectangles ({{ drawnRectangles.length }})
      </button>

      <!-- ── Horizontal price line tool ──────────────────────────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': lineModeActive }"
        @click="toggleLineMode"
        title="Click to enable, then double-click anywhere on the chart to drop a horizontal price line"
      >
        {{ lineModeActive ? 'Line: double-click to place…' : 'Line' }}
      </button>

      <button
        v-if="priceLines.length > 0"
        class="tool-btn"
        @click="priceLines = []"
      >
        Clear Lines ({{ priceLines.length }})
      </button>

      <!-- ── Price range tool ─────────────────────────────────────────────── -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn-active': priceRangeModeActive }"
        @click="togglePriceRangeMode"
        title="Click to enable, then click-drag vertically to measure the distance between two price levels"
      >
        {{ priceRangeModeActive ? 'Price Range: pick two levels…' : 'Price Range' }}
      </button>

      <button
        v-if="priceRanges.length > 0"
        class="tool-btn"
        @click="priceRanges = []"
      >
        Clear Ranges ({{ priceRanges.length }})
      </button>

      <!-- ── Backtest playback controls ────────────────────────────────── -->
      <div class="backtest-controls">
        <button
          v-if="!backtestActive"
          class="tool-btn"
          @click="startBacktest"
        >
          ▶ Start Backtest
        </button>

        <template v-else>
          <button
            class="backtest-nav-btn"
            :disabled="backtestIndex === 0"
            @click="backtestPrev"
          >
            &lt; Prev
          </button>
          <span class="backtest-index-label">
            Candle {{ backtestIndex + 1 }} / {{ props.candles.length }}
          </span>
          <button
            class="backtest-nav-btn"
            :disabled="backtestIndex >= props.candles.length - 1"
            @click="backtestNext"
          >
            Next &gt;
          </button>
          <button class="backtest-stop-btn" @click="stopBacktest">
            Stop Backtest
          </button>

          <button
            class="preview-btn buy"
            :disabled="backtestPlacingSide !== null"
            @click="placeBacktestPosition('LONG')"
          >
            {{ backtestPlacingSide === 'LONG' ? 'Loading…' : 'Long' }}
          </button>
          <button
            class="preview-btn sell"
            :disabled="backtestPlacingSide !== null"
            @click="placeBacktestPosition('SHORT')"
          >
            {{ backtestPlacingSide === 'SHORT' ? 'Loading…' : 'Short' }}
          </button>
          <span v-if="backtestPlaceError" class="backtest-place-error">{{ backtestPlaceError }}</span>
        </template>
      </div>

      <!-- ── Preview controls ─────────────────────────────────────────── -->
      <div class="preview-controls">
        <label class="margin-label">
          Margin
          <input
            v-model.number="previewMargin"
            type="number"
            min="0"
            step="1"
            class="margin-input"
            :disabled="previewLoading"
          />
        </label>

        <label class="margin-label">
          TP ROI %
          <input
            v-model.number="targetTpRoi"
            type="number"
            step="1"
            class="margin-input small"
            :disabled="previewLoading"
          />
        </label>

        <label class="margin-label">
          SL ROI %
          <input
            v-model.number="targetSlRoi"
            type="number"
            step="1"
            class="margin-input small"
            :disabled="previewLoading"
          />
        </label>

        <label class="margin-label">
          Max Leverage
          <input
            v-model.number="maxLeverage"
            type="number"
            min="1"
            step="1"
            class="margin-input small"
          />
        </label>

        <button
          class="preview-btn buy"
          :disabled="previewLoading || backtestActive"
          @click="previewBuy"
        >
          {{ previewLoading && pendingSide === 'LONG' ? 'Loading…' : 'Preview Buy' }}
        </button>

        <button
          class="preview-btn sell"
          :disabled="previewLoading || backtestActive"
          @click="previewSell"
        >
          {{ previewLoading && pendingSide === 'SHORT' ? 'Loading…' : 'Preview Sell' }}
        </button>

        <button
          class="preview-btn clear"
          :disabled="!previewPosition || previewLoading"
          @click="clearPreview"
        >
          Clear Preview
        </button>
      </div>

      <!-- Order book wall readout -->
      <div class="wall-readout">
        <span v-if="largestBidWall" class="wall-stat bid">
          Bid Wall {{ largestBidWall.price.toFixed(4) }} ({{ formatNotional(largestBidWall.price * largestBidWall.qty) }})
        </span>
        <span v-if="lowestAskWall" class="wall-stat ask">
          Ask Wall {{ lowestAskWall.price.toFixed(4) }} ({{ formatNotional(lowestAskWall.price * lowestAskWall.qty) }})
        </span>
        <span class="wall-stat depth-count">
          Book: {{ bidsRaw.length }} bids / {{ asksRaw.length }} asks
        </span>
      </div>

      <!-- Real-time order-book impact estimate (walks the book for the current margin × leverage notional) -->
      <div class="wall-readout impact-readout">
        <span class="wall-stat depth-count">
          Order size: {{ formatNotional(orderNotional) }}{{ maxLeverage > 1 ? ` (${maxLeverage}x)` : '' }}
        </span>
        <span v-if="bookImpact.long" class="wall-stat impact-long">
          Long {{ bookImpact.long.priceChange >= 0 ? '+' : '' }}{{ bookImpact.long.priceChange.toFixed(4) }}
          ({{ bookImpact.long.priceChangePercent >= 0 ? '+' : '' }}{{ bookImpact.long.priceChangePercent.toFixed(3) }}%)
          avg {{ bookImpact.long.vwapPrice.toFixed(4) }}{{ !bookImpact.long.fullyFilled ? ' · thin book' : '' }}
        </span>
        <span v-if="bookImpact.short" class="wall-stat impact-short">
          Short {{ bookImpact.short.priceChange.toFixed(4) }}
          ({{ bookImpact.short.priceChangePercent.toFixed(3) }}%)
          avg {{ bookImpact.short.vwapPrice.toFixed(4) }}{{ !bookImpact.short.fullyFilled ? ' · thin book' : '' }}
        </span>
      </div>

      <!-- Live status indicators -->
      <div class="live-indicator" :class="wsStatus">
        <span class="live-dot" />
        <span class="live-label">Kline: {{ wsStatusLabel }}</span>
      </div>
      <div class="live-indicator" :class="depthWsStatus">
        <span class="live-dot" />
        <span class="live-label">Depth: {{ depthWsStatusLabel }}</span>
      </div>
      <div v-if="candleCloseCountdown" class="live-indicator candle-countdown">
        <span class="live-label">Closes in {{ candleCloseCountdown }}</span>
      </div>
    </div>

    <!-- Preview summary panel -->
    <div v-if="previewPosition" class="preview-panel" :class="previewPosition.side.toLowerCase()">
      <span class="preview-side-badge" :class="previewPosition.side.toLowerCase()">{{ previewPosition.side }}</span>
      <span class="preview-stat"><label>Entry</label><span>{{ previewPosition.entryPrice.toFixed(4) }}</span></span>
      <span class="preview-stat tp">
        <label>TP</label>
        <input
          type="number"
          step="any"
          class="preview-price-input tp"
          v-model.number="previewPosition.tpPrice"
        />
      </span>
      <span class="preview-stat sl">
        <label>SL</label>
        <input
          type="number"
          step="any"
          class="preview-price-input sl"
          v-model.number="previewPosition.slPrice"
        />
      </span>
      <span class="preview-stat rr" :class="{ 'rr-bad': previewRR !== null && previewRR < 1 }">
        <label>R:R</label>
        <span>{{ previewRR !== null ? previewRR.toFixed(2) : '—' }}</span>
      </span>
      <button
        class="preview-btn place-order"
        :disabled="placingOrder"
        @click="openOrderChecklist"
      >
        {{ placingOrder ? 'Placing…' : 'Place Order' }}
      </button>
      <button class="preview-panel-close" @click="clearPreview">×</button>
    </div>
    <div v-if="previewError" class="preview-error">{{ previewError }}</div>

    <div class="chart-container" ref="chartContainer" @wheel="handleZoom" @mousemove="handleMouseMove" @mouseleave="handleMouseLeave" @mousedown="handleChartMouseDown" @dblclick="handleChartDoubleClick">
      <svg :width="svgWidth" :height="totalSvgHeight" class="candles-svg">
        <!-- Crosshair Lines -->
        <g v-show="true" ref="crosshairGroup" class="crosshair">
          <line
            x1="0"
            y1="0"
            :x2="svgWidth"
            y2="0"
            class="crosshair-line horizontal"
            style="display: none"
          />
          <line
            x1="0"
            y1="0"
            x2="0"
            :y2="totalSvgHeight"
            class="crosshair-line vertical"
            style="display: none"
          />
        </g>

        <!-- Price Zone Backgrounds (grouped by session) -->
        <g class="price-zones">
          <rect
            v-for="(zone, i) in zoneRectangles"
            :key="`zone-${i}`"
            :x="zone.x"
            :y="zone.y"
            :width="zone.width"
            :height="zone.height"
            :class="['zone-rect', { 'zone-active': zone.isActive }]"
          />
        </g>

        <!-- Price Zone Mid Lines -->
        <g class="zone-mid-lines">
          <line
            v-for="(midLine, i) in zoneMidLines"
            :key="`mid-line-${i}`"
            :x1="midLine.x1"
            :y1="midLine.y"
            :x2="midLine.x2"
            :y2="midLine.y"
            class="mid-line"
          />
        </g>

        <!-- Support/Resistance Lines -->
        <g class="support-resistance-lines">
          <line
            v-for="(line, i) in supportResistanceLines"
            :key="`sr-line-${i}`"
            :x1="line.x1"
            :y1="line.y"
            :x2="line.x2"
            :y2="line.y"
            :class="['sr-line', `sr-${line.type}`]"
          />

          <!-- Order book large-order walls -->
          <line
            v-if="largestBidWall"
            :x1="0" :x2="svgWidth"
            :y1="priceToY(largestBidWall.price)" :y2="priceToY(largestBidWall.price)"
            class="sr-line sr-bid-wall"
          />
          <line
            v-if="lowestAskWall"
            :x1="0" :x2="svgWidth"
            :y1="priceToY(lowestAskWall.price)" :y2="priceToY(lowestAskWall.price)"
            class="sr-line sr-ask-wall"
          />
        </g>

        <!-- Order book wall price labels -->
        <g class="wall-price-labels">
          <text
            v-if="largestBidWall"
            :x="6"
            :y="priceToY(largestBidWall.price) - 4"
            class="wall-price-label bid"
          >
            Bid {{ largestBidWall.price.toFixed(4) }} · {{ formatNotional(largestBidWall.price * largestBidWall.qty) }}
          </text>
          <text
            v-if="lowestAskWall"
            :x="6"
            :y="priceToY(lowestAskWall.price) - 4"
            class="wall-price-label ask"
          >
            Ask {{ lowestAskWall.price.toFixed(4) }} · {{ formatNotional(lowestAskWall.price * lowestAskWall.qty) }}
          </text>
        </g>

        <!-- TP/SL Boxes -->
        <g class="tp-sl-boxes">
          <rect
            v-for="(box, i) in tpSlBoxes"
            :key="`tp-sl-${i}`"
            :x="box.x"
            :y="box.y"
            :width="box.width"
            :height="box.height"
            :class="['tp-sl-rect', `box-${box.type}`, `status-${box.status}`]"
          />

          <!-- Preview TP/SL Boxes -->
          <rect
            v-for="(box, i) in previewTpSlBoxes"
            :key="`preview-tp-sl-${i}`"
            :x="box.x"
            :y="box.y"
            :width="box.width"
            :height="box.height"
            :class="['tp-sl-rect', 'preview-rect', `box-${box.type}`]"
          />

          <!-- Preview entry line -->
          <line
            v-if="previewPosition"
            :x1="candleX(displayCandles.length - 1) - candleWidth / 2"
            :x2="svgWidth"
            :y1="priceToY(previewPosition.entryPrice)"
            :y2="priceToY(previewPosition.entryPrice)"
            class="preview-entry-line"
          />

          <!-- Preview TP/SL drag handles — visible line + a wider invisible
               hit-area line on top of it so the price is easy to grab. -->
          <template v-if="previewPosition">
            <line
              :x1="candleX(displayCandles.length - 1) - candleWidth / 2"
              :x2="svgWidth"
              :y1="priceToY(previewPosition.tpPrice)"
              :y2="priceToY(previewPosition.tpPrice)"
              class="preview-tp-line"
            />
            <line
              :x1="candleX(displayCandles.length - 1) - candleWidth / 2"
              :x2="svgWidth"
              :y1="priceToY(previewPosition.tpPrice)"
              :y2="priceToY(previewPosition.tpPrice)"
              class="preview-hit-line"
              @mousedown="startPreviewTpDrag($event)"
            />

            <line
              :x1="candleX(displayCandles.length - 1) - candleWidth / 2"
              :x2="svgWidth"
              :y1="priceToY(previewPosition.slPrice)"
              :y2="priceToY(previewPosition.slPrice)"
              class="preview-sl-line"
            />
            <line
              :x1="candleX(displayCandles.length - 1) - candleWidth / 2"
              :x2="svgWidth"
              :y1="priceToY(previewPosition.slPrice)"
              :y2="priceToY(previewPosition.slPrice)"
              class="preview-hit-line"
              @mousedown="startPreviewSlDrag($event)"
            />
          </template>
        </g>

        <!-- Backtest long/short position placements -->
        <g class="backtest-positions">
          <rect
            v-for="box in backtestPositionBoxes"
            :key="box.id"
            :x="box.x"
            :y="box.y"
            :width="box.width"
            :height="box.height"
            :class="['tp-sl-rect', `box-${box.type}`, `status-${box.status}`]"
          />

          <!-- Per-position freeform drag controls, same idea as the
               Rectangle tool: everything below is grabbable and moves the
               position independently of the live/backtest candle stream. -->
          <template v-for="pos in renderedBacktestPositions" :key="`bt-drag-${pos.id}`">
            <!-- TP line -->
            <line
              :x1="candleX(pos.entryIndex) - candleWidth / 2"
              :x2="candleX(pos.endIndex) + candleWidth / 2"
              :y1="priceToY(pos.tpPrice)"
              :y2="priceToY(pos.tpPrice)"
              class="backtest-tp-line"
            />
            <line
              :x1="candleX(pos.entryIndex) - candleWidth / 2"
              :x2="candleX(pos.endIndex) + candleWidth / 2"
              :y1="priceToY(pos.tpPrice)"
              :y2="priceToY(pos.tpPrice)"
              class="backtest-hit-line"
              @mousedown="startBacktestTpDrag(pos.id, $event)"
            />

            <!-- SL line -->
            <line
              :x1="candleX(pos.entryIndex) - candleWidth / 2"
              :x2="candleX(pos.endIndex) + candleWidth / 2"
              :y1="priceToY(pos.slPrice)"
              :y2="priceToY(pos.slPrice)"
              class="backtest-sl-line"
            />
            <line
              :x1="candleX(pos.entryIndex) - candleWidth / 2"
              :x2="candleX(pos.endIndex) + candleWidth / 2"
              :y1="priceToY(pos.slPrice)"
              :y2="priceToY(pos.slPrice)"
              class="backtest-hit-line"
              @mousedown="startBacktestSlDrag(pos.id, $event)"
            />

            <!-- Entry line -->
            <line
              :x1="candleX(pos.entryIndex) - candleWidth / 2"
              :x2="candleX(pos.endIndex) + candleWidth / 2"
              :y1="priceToY(pos.entryPrice)"
              :y2="priceToY(pos.entryPrice)"
              class="backtest-entry-line"
            />
            <line
              :x1="candleX(pos.entryIndex) - candleWidth / 2"
              :x2="candleX(pos.endIndex) + candleWidth / 2"
              :y1="priceToY(pos.entryPrice)"
              :y2="priceToY(pos.entryPrice)"
              class="backtest-hit-line"
              @mousedown="startBacktestEntryDrag(pos.id, $event)"
            />

            <!-- Move handle: drag freely (x snaps to nearest candle, y is
                 free) to reposition the whole thing — entry/TP/SL shift
                 together, offsets preserved. -->
            <circle
              :cx="candleX(pos.entryIndex) - candleWidth / 2"
              :cy="priceToY(pos.entryPrice)"
              r="6"
              class="backtest-move-handle"
              @mousedown="startBacktestMoveDrag(pos.id, $event)"
            />
          </template>

          <text
            v-for="pos in renderedBacktestPositions"
            :key="`bt-label-${pos.id}`"
            :x="candleX(pos.entryIndex) - candleWidth / 2 + 4"
            :y="priceToY(pos.entryPrice) - 6"
            :class="['backtest-position-label', pos.side === 'LONG' ? 'label-long' : 'label-short']"
          >
            {{ pos.side }} @ {{ pos.entryPrice.toFixed(4) }}
          </text>

          <text
            v-for="pos in renderedBacktestPositions"
            :key="`bt-remove-${pos.id}`"
            :x="candleX(pos.endIndex) + candleWidth / 2 - 4"
            :y="priceToY(pos.entryPrice) - 6"
            text-anchor="end"
            class="backtest-position-close"
            @click="removeBacktestPosition(pos.id)"
          >
            ✕ remove
          </text>
        </g>

        <!-- Volume Spike Connection Line -->
        <polyline
          v-if="connectVolumeSpikesvSpikes && volumeSpikePoints.length > 0"
          :points="volumeSpikePoints"
          class="volume-spike-line"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />

        <!-- Volume Spike Change Labels -->
        <g v-if="connectVolumeSpikesvSpikes && volumeSpikeChangeLabels.length > 0" class="volume-spike-labels">
          <text
            v-for="(label, i) in volumeSpikeChangeLabels"
            :key="`vol-spike-label-${i}`"
            :x="label.x"
            :y="label.y"
            :class="['volume-spike-label', label.changePositive ? 'positive' : 'negative']"
          >
            {{ label.text }}
          </text>
        </g>

        <!-- Grid Lines -->
        <g class="grid">
          <line
            v-for="(price, i) in gridPrices"
            :key="`grid-${i}`"
            :x1="0"
            :y1="priceToY(price)"
            :x2="svgWidth"
            :y2="priceToY(price)"
            class="grid-line"
          />
        </g>

        <!-- Broken orange line when a candle's zone is fully inhabited (zoneInhabitantCount === 24) -->
        <g class="zone-full-lines">
          <line
            v-for="(x, i) in zoneFullVerticalLines"
            :key="`zone-full-${i}`"
            :x1="x"
            :y1="0"
            :x2="x"
            :y2="svgHeight"
            class="zone-full-line"
          />
        </g>

        <!-- Volume panel background + separator (own section below the price chart) -->
        <template v-if="panelLayout.volume">
          <rect
            x="0"
            :y="panelLayout.volume.top"
            :width="svgWidth"
            :height="panelLayout.volume.bottom - panelLayout.volume.top"
            class="indicator-panel-bg"
          />
          <line
            x1="0"
            :x2="svgWidth"
            :y1="panelLayout.volume.top"
            :y2="panelLayout.volume.top"
            class="indicator-panel-separator"
          />
        </template>

        <!-- Volume Bars — own section below the price chart, doesn't overlap candles -->
        <g v-if="showVolume" class="volume-bars">
          <rect
            v-for="(bar, i) in volumeBars"
            :key="`volume-${i}`"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            :class="['volume-bar', bar.isBull ? 'bull' : 'bear']"
          />
        </g>

        <!-- Volume panel max label -->
        <text
          v-if="showVolume && maxVolumeInView > 0 && panelLayout.volume"
          :x="6"
          :y="panelLayout.volume.top + 14"
          class="volume-panel-label"
        >
          Vol max {{ formatNotional(maxVolumeInView) }}
        </text>

        <!-- Wallet Movement panel background + separator (own section below volume) -->
        <template v-if="panelLayout.movement">
          <rect
            x="0"
            :y="panelLayout.movement.top"
            :width="svgWidth"
            :height="panelLayout.movement.bottom - panelLayout.movement.top"
            class="indicator-panel-bg"
          />
          <line
            x1="0"
            :x2="svgWidth"
            :y1="panelLayout.movement.top"
            :y2="panelLayout.movement.top"
            class="indicator-panel-separator"
          />
        </template>

        <!-- Wallet Movement Bars — inflow (green) stacked above outflow (red), own section -->
        <g v-if="showMovementPanel" class="movement-bars">
          <template v-for="bar in movementBars" :key="`movement-${bar.index}`">
            <rect
              v-if="bar.inflowHeight > 0"
              :x="bar.x"
              :y="bar.inflowY"
              :width="bar.width"
              :height="bar.inflowHeight"
              class="movement-bar movement-bar-inflow"
              @click="openMovementDetail(bar.index)"
            >
              <title>Inflow — click for detail</title>
            </rect>
            <rect
              v-if="bar.outflowHeight > 0"
              :x="bar.x"
              :y="bar.outflowY"
              :width="bar.width"
              :height="bar.outflowHeight"
              class="movement-bar movement-bar-outflow"
              @click="openMovementDetail(bar.index)"
            >
              <title>Outflow — click for detail</title>
            </rect>
          </template>
        </g>

        <!-- Wallet Movement panel max label / status -->
        <text
          v-if="showMovementPanel && maxMovementInView > 0 && panelLayout.movement && !movementLoading"
          :x="6"
          :y="panelLayout.movement.top + 14"
          class="movement-panel-label"
        >
          Movement max {{ formatNotional(maxMovementInView) }} · inflow green / outflow red
        </text>
        <text
          v-if="showMovementPanel && movementLoading && panelLayout.movement"
          :x="6"
          :y="panelLayout.movement.top + 14"
          class="movement-panel-label"
        >
          Loading wallet movement…
        </text>
        <text
          v-if="showMovementPanel && movementError && panelLayout.movement"
          :x="6"
          :y="panelLayout.movement.top + 14"
          class="movement-panel-label movement-panel-label-error"
        >
          Movement: {{ movementError }}
        </text>

        <!-- OI panel background + separator (own section below volume) -->
        <template v-if="panelLayout.oi">
          <rect
            x="0"
            :y="panelLayout.oi.top"
            :width="svgWidth"
            :height="panelLayout.oi.bottom - panelLayout.oi.top"
            class="indicator-panel-bg"
          />
          <line
            x1="0"
            :x2="svgWidth"
            :y1="panelLayout.oi.top"
            :y2="panelLayout.oi.top"
            class="indicator-panel-separator"
          />
        </template>

        <!-- Open Interest Bars — own section, doesn't overlap volume or candles -->
        <g v-if="showOiBar" class="oi-bars">
          <rect
            v-for="(bar, i) in oiBars"
            :key="`oi-${i}`"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            class="oi-bar"
          />
        </g>

        <!-- OI panel max label / status -->
        <text
          v-if="showOiBar && maxOiInView > 0 && panelLayout.oi"
          :x="6"
          :y="panelLayout.oi.top + 14"
          class="oi-panel-label"
        >
          OI max {{ formatNotional(maxOiInView) }}
        </text>
        <text
          v-if="showOiBar && oiLoading && panelLayout.oi"
          :x="6"
          :y="panelLayout.oi.top + 14"
          class="oi-panel-label"
        >
          Loading OI…
        </text>
        <text
          v-if="showOiBar && oiError && panelLayout.oi"
          :x="6"
          :y="panelLayout.oi.top + 14"
          class="oi-panel-label oi-panel-label-error"
        >
          OI: {{ oiError }}
        </text>

        <!-- L/S panel background + separator (own section below OI) -->
        <template v-if="panelLayout.ls">
          <rect
            x="0"
            :y="panelLayout.ls.top"
            :width="svgWidth"
            :height="panelLayout.ls.bottom - panelLayout.ls.top"
            class="indicator-panel-bg"
          />
          <line
            x1="0"
            :x2="svgWidth"
            :y1="panelLayout.ls.top"
            :y2="panelLayout.ls.top"
            class="indicator-panel-separator"
          />
        </template>

        <!-- Long/Short Ratio — own section, doesn't overlap OI/volume/candles -->
        <line
          v-if="showLongShortRatio && lsRatioBars.length > 0"
          x1="0"
          :x2="svgWidth"
          :y1="lsRatioCenterY"
          :y2="lsRatioCenterY"
          class="ls-ratio-centerline"
        />
        <g v-if="showLongShortRatio" class="ls-ratio-bars">
          <rect
            v-for="(bar, i) in lsRatioBars"
            :key="`ls-${i}`"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            :class="['ls-ratio-bar', bar.long ? 'ls-ratio-bar-long' : 'ls-ratio-bar-short']"
          />
        </g>
        <text
          v-if="showLongShortRatio && lsRatioBars.length > 0"
          :x="6"
          :y="lsRatioPanelTopY + 14"
          class="ls-ratio-panel-label"
        >
          Long% (green) / Short% (red) — zoomed to range
        </text>
        <text
          v-if="showLongShortRatio && lsRatioLoading"
          :x="6"
          :y="lsRatioPanelTopY + 14"
          class="ls-ratio-panel-label"
        >
          Loading L/S ratio…
        </text>
        <text
          v-if="showLongShortRatio && lsRatioError"
          :x="6"
          :y="lsRatioPanelTopY + 14"
          class="ls-ratio-panel-label ls-ratio-panel-label-error"
        >
          L/S: {{ lsRatioError }}
        </text>

        <!-- EMA9 Line -->
        <polyline
          v-if="showEma && emaPoints.length > 0"
          :points="emaPoints"
          class="ema-line"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />

        <!-- MA200 Line -->
        <polyline
          v-if="showMa && ma200Points.length > 0"
          :points="ma200Points"
          class="ma200-line"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />

        <!-- MA100 Line -->
        <polyline
          v-if="showMa && ma100Points.length > 0"
          :points="ma100Points"
          class="ma100-line"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />

        <!-- Cross-Timeframe EMA200 Lines (1h / 4h / 1d) -->
        <g v-if="showCrossTfEma">
          <template v-for="line in crossTfEmaLines" :key="`cross-tf-ema-${line.tf}`">
            <polyline
              v-if="line.hasPoints"
              :points="line.points"
              class="cross-tf-ema-line"
              :style="{ stroke: line.color }"
              fill="none"
              stroke-width="1.5"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
            <text
              v-if="line.hasPoints"
              :x="line.labelX"
              :y="line.labelY"
              class="cross-tf-ema-label"
              :style="{ fill: line.color }"
            >
              {{ line.label }}
            </text>
          </template>
        </g>

        <!-- Zone Labels -->
        <g class="zone-labels">
          <text
            v-for="(label, i) in zoneLabels"
            :key="`label-${i}`"
            :x="label.x"
            :y="label.y"
            class="zone-label-text"
          >
          {{ label.text }}
          </text>
        </g>

        <!-- Pattern Track Indicators -->
        <g v-for="(candle, i) in displayCandles" :key="`pattern-${i}`" class="pattern-track-indicators">
          <!-- Weakening Indicator -->
          <g v-if="candle.isWeakening" class="weakening-indicator">
            <polygon
              :points="`
                ${candleX(i)},${priceToY(candle.low!) + 62}
                ${candleX(i) - 5},${priceToY(candle.low!) + 70}
                ${candleX(i)},${priceToY(candle.low!) + 78}
                ${candleX(i) + 5},${priceToY(candle.low!) + 70}
              `"
              class="weakening-diamond"
            />
          </g>

          <g v-if="candle.patternTrack === 'hl'" class="higher-low-indicator">
            <circle
              :cx="candleX(i)"
              :cy="priceToY(candle.low!) + 15"
              r="3"
              class="hl-dot"
            />
            <text
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 28"
              class="pattern-label"
            >
              HL
            </text>
          </g>

          <text
              v-if="candle.candleData?.isCandleInAbsorption"
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 45"
              class="pattern-label"
            >
              x
            </text>

            <text
              v-if="candle.candleData?.isSellingExhaustion"
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 55"
              class="pattern-label"
            >
              S
            </text>

            <text
              v-if="candle.candleData?.isBuyingExhaustion"
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 55"
              class="pattern-label"
            >
              B
            </text>

            <text
              v-if="candle.candleData?.crossedAvwapPoint"
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 65"
              class="pattern-label"
            >
              [V]
            </text>

          <g v-if="candle.patternTrack === 'lh'" class="lower-high-indicator">
            <circle
              :cx="candleX(i)"
              :cy="priceToY(candle.high!) - 15"
              r="3"
              class="lh-dot"
            />
            <text
              :x="candleX(i)"
              :y="priceToY(candle.high!) - 20"
              class="pattern-label"
            >
              LH
            </text>
          </g>
        </g>

        <!-- Multi-TF candles (1H/4H/1D), drawn faded behind the base candles.
             Each bar's right edge can be dragged backward to "scrub" the
             higher-TF candle back to a partial/in-progress state for
             backtesting — e.g. what did this 4H candle look like 5 base
             candles before it actually closed. -->
        <g v-if="showMultiTf1h || showMultiTf4h || showMultiTf1d" class="multi-tf-candles">
          <g
            v-for="bar in multiTfCandleRenderBars"
            :key="bar.key"
            :class="['multi-tf-candle', bar.tf, { bull: bar.isBull, bear: !bar.isBull, partial: bar.isPartial }]"
          >
            <line
              :x1="bar.wickX" :y1="bar.wickY1"
              :x2="bar.wickX" :y2="bar.wickY2"
              class="multi-tf-wick"
              :style="{ stroke: bar.color }"
            />
            <rect
              :x="bar.x"
              :y="bar.bodyY"
              :width="bar.width"
              :height="bar.bodyHeight"
              class="multi-tf-body"
              :class="{ 'multi-tf-body-partial': bar.isPartial }"
              :style="{ fill: bar.color, stroke: bar.color }"
            />

            <!-- Invisible fat hit-area on the right edge: drag to scrub
                 backward, drag back to the natural end (or double-click)
                 to snap back to the full closed candle. -->
            <line
              :x1="bar.handleX" :x2="bar.handleX"
              :y1="bar.handleTop" :y2="bar.handleBottom"
              class="multi-tf-edge-handle"
              @mousedown="startMultiTfBarResize(bar.tf, bar.startIndex, bar.naturalEndIndex, $event)"
              @dblclick="resetMultiTfBar(bar.tf, bar.startIndex)"
            />

            <text
              v-if="bar.isPartial"
              :x="bar.handleX + 4"
              :y="bar.wickY1 - 4"
              class="multi-tf-partial-label"
              :style="{ fill: bar.color }"
            >
              {{ bar.tf.toUpperCase() }} {{ bar.candleCount }}/{{ bar.totalCandleCount }}
            </text>
          </g>
        </g>

        <!-- Multi-TF lead-in candles: higher-TF candles that closed entirely
             before the first loaded base candle, drawn as their own
             base-candle-width bars prepended to the left of the chart
             (oldest → newest), e.g. [4h][4h][4h][4h][first 15m candle]... -->
        <g v-if="multiTfPrependRenderBars.length > 0" class="multi-tf-prepend-candles">
          <g
            v-for="bar in multiTfPrependRenderBars"
            :key="bar.key"
            :class="['multi-tf-prepend-candle', bar.tf, { bull: bar.isBull, bear: !bar.isBull }]"
          >
            <line
              :x1="bar.wickX" :y1="bar.wickY1"
              :x2="bar.wickX" :y2="bar.wickY2"
              class="multi-tf-prepend-wick"
              :style="{ stroke: bar.color }"
            />
            <rect
              :x="bar.x"
              :y="bar.bodyY"
              :width="bar.width"
              :height="bar.bodyHeight"
              class="multi-tf-prepend-body"
              :style="{ fill: bar.color, stroke: bar.color }"
            />
            <text
              v-if="bar.isFirstOfLane"
              :x="bar.x"
              :y="bar.wickY1 - 4"
              class="multi-tf-prepend-label"
              :style="{ fill: bar.color }"
            >
              {{ bar.tf.toUpperCase() }}
            </text>
          </g>
        </g>

        <!-- Candles -->
        <g class="candles">
          <g class="atr-extensions">
              <rect
                v-for="(candle, i) in displayCandles"
                :key="`atr-ext-${i}`"
                :x="candleX(i) - candleWidth / 2"
                :y="priceToY(Math.max(candle.close!, candle.close_atr_adjusted))"
                :width="candleWidth"
                :height="Math.abs(candle.close_atr_adjusted - candle.close!) / priceDelta * svgHeight"
                class="atr-extension-rect"
                :class="{'is_not_1': candle.close_atr_abs_change < 1}"
              />
            </g>
          <g
            v-for="(candle, i) in displayCandles"
            :key="`candle-${i}`"
            class="candle"
            :class="{ 
              bull: candle.close! >= candle.open!, 
              bear: candle.close! < candle.open!,
              indecisive: candle.candleData?.isIndecisive,
              live: i === displayCandles.length - 1 && liveCandle !== null,
              muted: isCandleMuted(i),
              'vp-target': vpModeActive,
              'avwap-target': avwapModeActive,
              'range-download-target': rangeDownloadModeActive,
              'range-investigate-target': rangeInvestigateModeActive,
              'summarize-target': summarizeModeActive
            }"
            @click="handleCandleClick(i)"
            @mousedown="handleCandleMouseDown(i, $event)"
            @mouseenter="hoveredCandleIndex = i"
            @mouseleave="hoveredCandleIndex = null"
          >

            <!-- Wick -->
            <line
              :x1="candleX(i)"
              :y1="priceToY(candle.high!)"
              :x2="candleX(i)"
              :y2="priceToY(candle.low!)"
              class="wick"
            />

            <!-- Body -->
            <rect
              :x="candleX(i) - candleWidth / 2"
              :y="priceToY(Math.max(candle.open!, candle.close!))"
              :width="candleWidth"
              :height="Math.max(Math.abs(candle.close! - candle.open!) / priceDelta * svgHeight, 1)"
              class="body"
            />

            <g v-if="candle.candleData?.volumeSpike" class="volume-spike-indicator">
              <circle
                :cx="candleX(i)"
                :cy="priceToY(candle.low!) + 29"
                r="4"
                class="volume-spike-dot"
              />
            </g>

            <g v-if="candle.volumeAnalysis?.zScore! > 3">
              <circle
                :cx="candleX(i)"
                :cy="priceToY(candle.low!) + 36"
                r="4"
                class="is-past-volume-good-dot"
              />
            </g>

            <g v-if="candle.candleData && candle.candleData.priceMove != 'normal'">
              <circle
                :cx="candleX(i)"
                :cy="priceToY(candle.low!) + 45"
                r="4"
                class="price-move"
              />
            </g>

            <g v-if="candle.candleData?.changePercentageZScore! > 3">
              <circle
                :cx="candleX(i)"
                :cy="priceToY(candle.low!) + 56"
                r="4"
                class="is-change-high-dot"
              />
            </g>

            <g v-if="candle.candleData?.isLongPotential" class="long-potential">
              <polygon
                :points="`${candleX(i)},${priceToY(candle.low!) + 25} ${candleX(i) - 5},${priceToY(candle.low!) + 33} ${candleX(i) + 5},${priceToY(candle.low!) + 33}`"/>
            </g>

            <g v-if="candle.candleData?.isShortPotential" class="short-potential">
              <polygon
                :points="`${candleX(i)},${priceToY(candle.high!) - 25} ${candleX(i) - 5},${priceToY(candle.high!) - 33} ${candleX(i) + 5},${priceToY(candle.high!) - 33}`"
                class="chevron-down"
              />
            </g>

            <!-- Overbought -->
            <g v-if="candle.overboughSoldAnalysis?.extremeLevel == 'overbought'" class="ob-indicator">
              <rect
                :x="candleX(i) - 3"
                :y="priceToY(candle.high!) - 10"
                width="6"
                height="6"
                class="ob-marker"
              />
            </g>

            <!-- Oversold -->
            <g v-if="candle.overboughSoldAnalysis?.extremeLevel == 'oversold'" class="os-indicator">
              <rect
                :x="candleX(i) - 3"
                :y="priceToY(candle.low!) + 10"
                width="6"
                height="6"
                class="os-marker"
              />
            </g>
          </g>
        </g>

        <!-- Volume Profile Fixed Range overlays -->
        <g class="volume-profiles">
          <g
            v-for="profile in renderedVolumeProfiles"
            :key="`vp-${profile.id}`"
            class="volume-profile"
          >
            <!-- range selection box -->
            <rect
              :x="profile.leftX"
              :y="profile.rangeTop"
              :width="(candleX(profile.endIndex) + candleWidth / 2) - profile.leftX"
              :height="profile.rangeBottom - profile.rangeTop"
              class="vp-range-rect"
            />

            <!-- Left/right edge resize handles: drag horizontally to
                 extend or shrink the profile's period after placement. -->
            <line
              :x1="profile.leftX" :x2="profile.leftX"
              :y1="profile.rangeTop" :y2="profile.rangeBottom"
              class="vp-edge-handle"
              @mousedown="startVpResizeLeft(profile.id, $event)"
            />
            <line
              :x1="candleX(profile.endIndex) + candleWidth / 2" :x2="candleX(profile.endIndex) + candleWidth / 2"
              :y1="profile.rangeTop" :y2="profile.rangeBottom"
              class="vp-edge-handle"
              @mousedown="startVpResizeRight(profile.id, $event)"
            />

            <!-- histogram rows: buy (left segment) + sell (right segment), stacked per row -->
            <g v-for="(row, rIdx) in profile.rows" :key="`vp-${profile.id}-row-${rIdx}`">
              <rect
                :x="row.x"
                :y="row.y"
                :width="row.buyWidth"
                :height="row.height"
                class="vp-row vp-buy"
              />
              <rect
                :x="row.x + row.buyWidth"
                :y="row.y"
                :width="row.sellWidth"
                :height="row.height"
                class="vp-row vp-sell"
              />
            </g>

            <!-- POC / mid line -->
            <line
              :x1="profile.leftX"
              :x2="profile.rightX"
              :y1="profile.pocY"
              :y2="profile.pocY"
              class="vp-poc-line"
            />
            <text
              :x="profile.rightX + 4"
              :y="profile.pocY + 3"
              class="vp-poc-label"
            >
              POC {{ profile.pocPrice.toFixed(4) }}
            </text>

            <!-- summary + remove control -->
            <text
              :x="profile.leftX + 4"
              :y="profile.rangeTop - 6"
              class="vp-summary-label"
            >
              Vol {{ formatNotional(profile.totalVolume) }}
            </text>
            <text
              :x="profile.leftX + 4"
              :y="profile.rangeTop - 34"
              class="vp-oi-label"
              :class="oiLabelClass(profile.id)"
            >
              {{ oiLabelText(profile.id) }}
            </text>
            <text
              :x="profile.leftX + 4"
              :y="profile.rangeTop - 20"
              class="vp-bias-label"
              :class="vpAnalysisLabelClass(profile.id)"
            >
              {{ vpAnalysisLabelText(profile.id) }}
            </text>
            <text
              :x="(candleX(profile.endIndex) + candleWidth / 2) - 4"
              :y="profile.rangeTop - 6"
              class="vp-close-btn"
              text-anchor="end"
              @click="removeVolumeProfile(profile.id)"
            >
              ✕ remove
            </text>

            <!-- buy/sell % footer, anchored under the bottom of the range box -->
            <text
              :x="profile.leftX + 4"
              :y="profile.rangeBottom + 14"
              class="vp-stats-label"
            >
              <tspan class="vp-stats-buy">B {{ profile.buyPct.toFixed(1) }}%</tspan>
              <tspan class="vp-stats-sep"> / </tspan>
              <tspan class="vp-stats-sell">S {{ profile.sellPct.toFixed(1) }}%</tspan>
            </text>
            <text
              :x="(candleX(profile.endIndex) + candleWidth / 2) - 4"
              :y="profile.rangeTop - 20"
              class="vp-download-btn"
              text-anchor="end"
              @click="downloadProfileData(profile.id)"
            >
              ⬇ download
            </text>

            <!-- Nudge end point one candle back/forward — sits above the OI label, left side -->
            <g class="vp-end-nudge">
              <rect
                :x="profile.leftX"
                :y="profile.rangeTop - 66"
                width="18" height="16" rx="3"
                class="vp-nudge-btn-bg"
                @click="nudgeVpEndIndex(profile.id, -1, $event)"
              />
              <text
                :x="profile.leftX + 9"
                :y="profile.rangeTop - 54"
                class="vp-nudge-btn-label"
                text-anchor="middle"
                @click="nudgeVpEndIndex(profile.id, -1, $event)"
              >
                ‹
              </text>
              <rect
                :x="profile.leftX + 20"
                :y="profile.rangeTop - 66"
                width="18" height="16" rx="3"
                class="vp-nudge-btn-bg"
                @click="nudgeVpEndIndex(profile.id, 1, $event)"
              />
              <text
                :x="profile.leftX + 29"
                :y="profile.rangeTop - 54"
                class="vp-nudge-btn-label"
                text-anchor="middle"
                @click="nudgeVpEndIndex(profile.id, 1, $event)"
              >
                ›
              </text>
            </g>
          </g>

          <!-- live drag preview -->
          <g v-if="draggingVolumeProfilePreview" class="volume-profile vp-preview">
            <rect
              :x="draggingVolumeProfilePreview.leftX"
              :y="draggingVolumeProfilePreview.rangeTop"
              :width="(candleX(draggingVolumeProfilePreview.endIndex) + candleWidth / 2) - draggingVolumeProfilePreview.leftX"
              :height="draggingVolumeProfilePreview.rangeBottom - draggingVolumeProfilePreview.rangeTop"
              class="vp-range-rect vp-range-rect-preview"
            />
            <g v-for="(row, rIdx) in draggingVolumeProfilePreview.rows" :key="`vp-preview-row-${rIdx}`">
              <rect :x="row.x" :y="row.y" :width="row.buyWidth" :height="row.height" class="vp-row vp-buy vp-preview-row" />
              <rect :x="row.x + row.buyWidth" :y="row.y" :width="row.sellWidth" :height="row.height" class="vp-row vp-sell vp-preview-row" />
            </g>
            <line
              :x1="draggingVolumeProfilePreview.leftX"
              :x2="draggingVolumeProfilePreview.rightX"
              :y1="draggingVolumeProfilePreview.pocY"
              :y2="draggingVolumeProfilePreview.pocY"
              class="vp-poc-line vp-preview-row"
            />
          </g>
        </g>

        <!-- Range Download tool overlay -->
        <g class="range-download-boxes">
          <g
            v-for="box in renderedRangeDownloadBoxes"
            :key="`range-dl-${box.id}`"
            class="range-download-box"
          >
            <rect
              :x="box.leftX"
              :y="box.rangeTop"
              :width="box.rightX - box.leftX"
              :height="box.rangeBottom - box.rangeTop"
              class="range-dl-rect"
            />

            <!-- Left/right edge resize handles: drag horizontally to
                 extend or shrink the selected range after placement. -->
            <line
              :x1="box.leftX" :x2="box.leftX"
              :y1="box.rangeTop" :y2="box.rangeBottom"
              class="range-dl-edge-handle"
              @mousedown="startRangeDownloadResizeLeft(box.id, $event)"
            />
            <line
              :x1="box.rightX" :x2="box.rightX"
              :y1="box.rangeTop" :y2="box.rangeBottom"
              class="range-dl-edge-handle"
              @mousedown="startRangeDownloadResizeRight(box.id, $event)"
            />

            <text
              :x="box.leftX + 4"
              :y="box.rangeTop - 6"
              class="range-dl-summary-label"
            >
              Range {{ box.endIndex - box.startIndex + 1 }} candles
            </text>

            <text
              :x="box.rightX - 4"
              :y="box.rangeTop - 6"
              class="range-dl-close-btn"
              text-anchor="end"
              @click="removeRangeDownloadBox(box.id)"
            >
              ✕ remove
            </text>

            <text
              :x="(box.leftX + box.rightX) / 2 - 6"
              :y="box.rangeTop - 20"
              class="range-dl-download-btn"
              text-anchor="end"
              @click="downloadRangeData(box.id)"
            >
              ⬇ download range
            </text>

            <text
              :x="(box.leftX + box.rightX) / 2 + 6"
              :y="box.rangeTop - 20"
              class="range-dl-analyze-btn"
              text-anchor="start"
              @click="analyzeRangeData(box.id)"
            >
              ▶ Analyze
            </text>
          </g>

          <!-- live drag preview -->
          <rect
            v-if="draggingRangeDownloadPreview"
            :x="draggingRangeDownloadPreview.leftX"
            :y="draggingRangeDownloadPreview.rangeTop"
            :width="draggingRangeDownloadPreview.rightX - draggingRangeDownloadPreview.leftX"
            :height="draggingRangeDownloadPreview.rangeBottom - draggingRangeDownloadPreview.rangeTop"
            class="range-dl-rect range-dl-rect-preview"
          />
        </g>

        <!-- Range Investigate tool overlay -->
        <g class="range-investigate-boxes">
          <g
            v-for="box in renderedRangeInvestigateBoxes"
            :key="`range-inv-${box.id}`"
            class="range-investigate-box"
          >
            <rect
              :x="box.leftX"
              :y="box.rangeTop"
              :width="box.rightX - box.leftX"
              :height="box.rangeBottom - box.rangeTop"
              class="range-inv-rect"
            />

            <line
              :x1="box.leftX" :x2="box.leftX"
              :y1="box.rangeTop" :y2="box.rangeBottom"
              class="range-inv-edge-handle"
              @mousedown="startRangeInvestigateResizeLeft(box.id, $event)"
            />
            <line
              :x1="box.rightX" :x2="box.rightX"
              :y1="box.rangeTop" :y2="box.rangeBottom"
              class="range-inv-edge-handle"
              @mousedown="startRangeInvestigateResizeRight(box.id, $event)"
            />

            <text
              :x="box.leftX + 4"
              :y="box.rangeTop - 6"
              class="range-inv-summary-label"
            >
              Range {{ box.endIndex - box.startIndex + 1 }} candles
            </text>

            <text
              :x="box.rightX - 4"
              :y="box.rangeTop - 6"
              class="range-inv-close-btn"
              text-anchor="end"
              @click="removeRangeInvestigateBox(box.id)"
            >
              ✕ remove
            </text>

            <text
              :x="(box.leftX + box.rightX) / 2"
              :y="box.rangeTop - 20"
              class="range-inv-investigate-btn"
              text-anchor="middle"
              @click="investigateRangeData(box.id)"
            >
              🔍 Investigate
            </text>

            <text
              :x="box.rightX + 8"
              :y="box.rangeTop - 20"
              class="range-inv-result-range-btn"
              :class="{ 'range-inv-result-range-btn-active': rangeInvestigateAddingResultRangeId === box.id }"
              text-anchor="start"
              @click="startAddResultRange(box.id)"
            >
              {{ rangeInvestigateAddingResultRangeId === box.id ? '📍 pick end candle…' : '➕ Result Range' }}
            </text>
          </g>

          <!-- After-the-fact "Result Range" boxes (endIndex+1 → resultEndIndex) -->
          <g
            v-for="rbox in renderedResultRangeBoxes"
            :key="`range-inv-result-${rbox.id}`"
            class="range-investigate-result-box"
          >
            <rect
              :x="rbox.leftX"
              :y="rbox.rangeTop"
              :width="rbox.rightX - rbox.leftX"
              :height="rbox.rangeBottom - rbox.rangeTop"
              class="range-inv-result-rect"
            />
            <text
              :x="rbox.leftX + 4"
              :y="rbox.rangeTop - 6"
              class="range-inv-result-label"
            >
              After-the-fact ({{ rbox.endIndex - rbox.startIndex + 1 }} candles)
            </text>
            <text
              :x="rbox.rightX - 4"
              :y="rbox.rangeTop - 6"
              class="range-inv-close-btn"
              text-anchor="end"
              @click="clearResultRange(rbox.id)"
            >
              ✕ remove
            </text>
          </g>

          <!-- live drag preview for the investigate range itself -->
          <rect
            v-if="draggingRangeInvestigatePreview"
            :x="draggingRangeInvestigatePreview.leftX"
            :y="draggingRangeInvestigatePreview.rangeTop"
            :width="draggingRangeInvestigatePreview.rightX - draggingRangeInvestigatePreview.leftX"
            :height="draggingRangeInvestigatePreview.rangeBottom - draggingRangeInvestigatePreview.rangeTop"
            class="range-inv-rect range-inv-rect-preview"
          />

          <!-- live drag preview for the result range's end candle -->
          <rect
            v-if="draggingResultRangePreview"
            :x="draggingResultRangePreview.leftX"
            :y="draggingResultRangePreview.rangeTop"
            :width="draggingResultRangePreview.rightX - draggingResultRangePreview.leftX"
            :height="draggingResultRangePreview.rangeBottom - draggingResultRangePreview.rangeTop"
            class="range-inv-result-rect range-inv-result-rect-preview"
          />
        </g>

        <!-- Summarize Movement tool overlay -->
        <g class="summarize-boxes">
          <g
            v-for="box in renderedSummarizeBoxes"
            :key="`summarize-${box.id}`"
            class="summarize-box"
          >
            <rect
              :x="box.leftX"
              :y="box.rangeTop"
              :width="box.rightX - box.leftX"
              :height="box.rangeBottom - box.rangeTop"
              class="summarize-rect"
            />

            <!-- Left/right edge resize handles, same as Range Download/Investigate. -->
            <line
              :x1="box.leftX" :x2="box.leftX"
              :y1="box.rangeTop" :y2="box.rangeBottom"
              class="summarize-edge-handle"
              @mousedown="startSummarizeResizeLeft(box.id, $event)"
            />
            <line
              :x1="box.rightX" :x2="box.rightX"
              :y1="box.rangeTop" :y2="box.rangeBottom"
              class="summarize-edge-handle"
              @mousedown="startSummarizeResizeRight(box.id, $event)"
            />

            <text
              :x="box.leftX + 4"
              :y="box.rangeTop - 6"
              class="summarize-label"
            >
              Range {{ box.endIndex - box.startIndex + 1 }} candles
            </text>

            <text
              :x="box.rightX - 4"
              :y="box.rangeTop - 6"
              class="summarize-close-btn"
              text-anchor="end"
              @click="removeSummarizeBox(box.id)"
            >
              ✕ remove
            </text>

            <text
              :x="(box.leftX + box.rightX) / 2"
              :y="box.rangeTop - 20"
              class="summarize-btn"
              text-anchor="middle"
              @click="summarizeMovementRange(box.id)"
            >
              📊 Summarize
            </text>
          </g>

          <!-- live drag preview -->
          <rect
            v-if="draggingSummarizePreview"
            :x="draggingSummarizePreview.leftX"
            :y="draggingSummarizePreview.rangeTop"
            :width="draggingSummarizePreview.rightX - draggingSummarizePreview.leftX"
            :height="draggingSummarizePreview.rangeBottom - draggingSummarizePreview.rangeTop"
            class="summarize-rect summarize-rect-preview"
          />
        </g>

        <!-- Freeform rectangle draw tool overlay -->
        <g class="draw-rectangles">
          <g
            v-for="rect in drawnRectangles"
            :key="`rect-${rect.id}`"
            class="draw-rect-group"
          >
            <rect
              :x="rect.x"
              :y="priceToY(rect.priceHigh)"
              :width="rect.width"
              :height="priceToY(rect.priceLow) - priceToY(rect.priceHigh)"
              class="draw-rect"
              @mousedown="startRectMoveDrag(rect.id, $event)"
            />

            <!-- Edge resize handles: left/right adjust x+width, top/bottom
                 adjust the stored priceHigh/priceLow directly. -->
            <line
              :x1="rect.x" :x2="rect.x"
              :y1="priceToY(rect.priceHigh)" :y2="priceToY(rect.priceLow)"
              class="draw-rect-edge draw-rect-edge-v"
              @mousedown="startRectResizeLeft(rect.id, $event)"
            />
            <line
              :x1="rect.x + rect.width" :x2="rect.x + rect.width"
              :y1="priceToY(rect.priceHigh)" :y2="priceToY(rect.priceLow)"
              class="draw-rect-edge draw-rect-edge-v"
              @mousedown="startRectResizeRight(rect.id, $event)"
            />
            <line
              :x1="rect.x" :x2="rect.x + rect.width"
              :y1="priceToY(rect.priceHigh)" :y2="priceToY(rect.priceHigh)"
              class="draw-rect-edge draw-rect-edge-h"
              @mousedown="startRectResizeTop(rect.id, $event)"
            />
            <line
              :x1="rect.x" :x2="rect.x + rect.width"
              :y1="priceToY(rect.priceLow)" :y2="priceToY(rect.priceLow)"
              class="draw-rect-edge draw-rect-edge-h"
              @mousedown="startRectResizeBottom(rect.id, $event)"
            />

            <text
              :x="rect.x + rect.width - 4"
              :y="priceToY(rect.priceHigh) - 6"
              class="draw-rect-close"
              text-anchor="end"
              @click="removeRectangle(rect.id)"
            >
              ✕ remove
            </text>
          </g>

          <!-- live drag preview -->
          <rect
            v-if="rectPreview"
            :x="rectPreview.x"
            :y="rectPreview.y"
            :width="rectPreview.width"
            :height="rectPreview.height"
            class="draw-rect draw-rect-preview"
          />
        </g>

        <!-- Horizontal price line tool overlay -->
        <g class="price-lines">
          <g
            v-for="line in priceLines"
            :key="`price-line-${line.id}`"
            class="price-line-group"
          >
            <line
              :x1="0" :x2="svgWidth"
              :y1="priceToY(line.price)" :y2="priceToY(line.price)"
              class="price-line"
            />
            <!-- wider invisible hit-area so the line is easy to grab and re-drag -->
            <line
              :x1="0" :x2="svgWidth"
              :y1="priceToY(line.price)" :y2="priceToY(line.price)"
              class="price-line-hit"
              @mousedown="startPriceLineDrag(line.id, $event)"
            />
            <text
              :x="svgWidth - 6"
              :y="priceToY(line.price) - 6"
              text-anchor="end"
              class="price-line-label"
            >
              {{ line.label ? `${line.label} · ` : '' }}{{ line.price.toFixed(4) }}
            </text>
            <text
              :x="6"
              :y="priceToY(line.price) - 6"
              class="price-line-close"
              @click="removePriceLine(line.id)"
            >
              ✕ remove
            </text>
          </g>
        </g>

        <!-- Price range tool overlay -->
        <g class="price-ranges">
          <g
            v-for="box in priceRanges"
            :key="`price-range-${box.id}`"
            class="price-range-group"
          >
            <rect
              :x="box.x"
              :y="Math.min(priceToY(box.startPrice), priceToY(box.endPrice))"
              :width="box.width"
              :height="Math.abs(priceToY(box.endPrice) - priceToY(box.startPrice))"
              class="price-range-box"
              :class="priceRangeIsUp(box) ? 'price-range-up' : 'price-range-down'"
            />
            <text
              :x="box.x + box.width / 2"
              :y="(priceToY(box.startPrice) + priceToY(box.endPrice)) / 2"
              text-anchor="middle"
              class="price-range-label"
              :class="priceRangeIsUp(box) ? 'price-range-up-text' : 'price-range-down-text'"
            >
              {{ priceRangeDiff(box) >= 0 ? '+' : '' }}{{ priceRangeDiff(box).toFixed(4) }} ({{ priceRangePercent(box) >= 0 ? '+' : '' }}{{ priceRangePercent(box).toFixed(2) }}%)
            </text>
            <text
              :x="box.x + box.width - 4"
              :y="Math.min(priceToY(box.startPrice), priceToY(box.endPrice)) - 6"
              text-anchor="end"
              class="price-range-close"
              @click="removePriceRange(box.id)"
            >
              ✕ remove
            </text>
          </g>

          <!-- live drag preview -->
          <g v-if="priceRangePreview">
            <rect
              :x="priceRangePreview.x"
              :y="priceRangePreview.y"
              :width="priceRangePreview.width"
              :height="priceRangePreview.height"
              class="price-range-box price-range-preview"
              :class="priceRangeIsUp(priceRangePreview) ? 'price-range-up' : 'price-range-down'"
            />
            <text
              :x="priceRangePreview.x + priceRangePreview.width / 2"
              :y="priceRangePreview.y + priceRangePreview.height / 2"
              text-anchor="middle"
              class="price-range-label"
              :class="priceRangeIsUp(priceRangePreview) ? 'price-range-up-text' : 'price-range-down-text'"
            >
              {{ priceRangeDiff(priceRangePreview) >= 0 ? '+' : '' }}{{ priceRangeDiff(priceRangePreview).toFixed(4) }} ({{ priceRangePercent(priceRangePreview) >= 0 ? '+' : '' }}{{ priceRangePercent(priceRangePreview).toFixed(2) }}%)
            </text>
          </g>
        </g>

        <!-- Anchored VWAP tool overlay -->
        <g class="anchored-vwaps">
          <g
            v-for="avwap in anchoredVwapSeries"
            :key="`avwap-${avwap.id}`"
            class="avwap-group"
          >
            <!-- shaded band between upper/lower -->
            <polygon
              v-if="showAvwapBands && avwap.points.length > 1"
              :points="avwapBandPolygon(avwap.points)"
              class="avwap-band-fill"
              :style="{ fill: avwap.color }"
            />

            <!-- upper band -->
            <polyline
              v-if="showAvwapBands && avwap.points.length > 1"
              :points="avwapLinePoints(avwap.points, 'upper')"
              class="avwap-band-line"
              :style="{ stroke: avwap.color }"
            />

            <!-- lower band -->
            <polyline
              v-if="showAvwapBands && avwap.points.length > 1"
              :points="avwapLinePoints(avwap.points, 'lower')"
              class="avwap-band-line"
              :style="{ stroke: avwap.color }"
            />

            <!-- mid (the VWAP itself) -->
            <polyline
              v-if="avwap.points.length > 1"
              :points="avwapLinePoints(avwap.points, 'mid')"
              class="avwap-mid-line"
              :style="{ stroke: avwap.color }"
            />

            <!-- anchor marker -->
            <circle
              :cx="candleX(avwap.anchorIndex)"
              :cy="priceToY(avwap.anchorPrice)"
              r="4"
              class="avwap-anchor-dot"
              :style="{ fill: avwap.color }"
            />
            <text
              :x="candleX(avwap.anchorIndex) + 7"
              :y="priceToY(avwap.anchorPrice) - 7"
              class="avwap-anchor-close"
              @click="removeAnchoredVwap(avwap.id)"
            >
              AVWAP ✕
            </text>

            <!-- end handle — always visible; drag to pin the series to an earlier candle. Hollow = auto-extending to the latest candle, filled = pinned to a fixed end (drag back out to the last candle to reopen it). -->
            <line
              :x1="candleX(avwap.effectiveEndIndex)"
              :y1="priceToY(avwap.endPrice) - 14"
              :x2="candleX(avwap.effectiveEndIndex)"
              :y2="priceToY(avwap.endPrice) + 14"
              class="avwap-end-guide"
              :style="{ stroke: avwap.color }"
            />
            <rect
              :x="candleX(avwap.effectiveEndIndex) - 5"
              :y="priceToY(avwap.endPrice) - 5"
              width="10"
              height="10"
              :class="[
                'avwap-end-handle',
                avwap.isOpenEnded ? 'avwap-end-handle-open' : 'avwap-end-handle-pinned',
                { 'avwap-end-handle-dragging': avwapEndDraggingId === avwap.id }
              ]"
              :style="avwap.isOpenEnded ? { stroke: avwap.color } : { fill: avwap.color }"
              @mousedown="startAvwapEndDrag(avwap.id, $event)"
            />
          </g>
        </g>

        <!-- Price Axis Labels (Interactive) -->
        <text
          v-for="(price, i) in gridPrices"
          :key="`price-${i}`"
          :x="svgWidth - 1"
          :y="priceToY(price) + 4"
          class="price-label"
          @mousedown="startPriceAdjust(price, i, $event)"
          :style="{ cursor: 'ns-resize' }"
        >
          {{ price.toFixed(4) }}
        </text>

        <!-- Live price label on the right axis -->
        <g v-if="liveCandle" class="live-price-label-group">
          <rect
            :x="svgWidth - 50"
            :y="priceToY(liveCandle.close!) - 9"
            width="62"
            height="16"
            :class="['live-price-bg', liveCandle.close! >= liveCandle.open! ? 'bull-bg' : 'bear-bg']"
            rx="3"
          />
          <text
            :x="svgWidth - 25"
            :y="priceToY(liveCandle.close!) + 4"
            class="live-price-text"
          >
            {{ liveCandle.close!.toFixed(4) }}
          </text>
        </g>

        <!-- Pre-Trade Checklist Modal (draggable, appears on "Place Order") -->
        <g
          v-if="showOrderChecklist"
          :transform="`translate(${orderChecklistPos.x},${orderChecklistPos.y})`"
          class="order-checklist-group"
        >
          <foreignObject width="340" height="480">
            <div xmlns="http://www.w3.org/1999/xhtml" class="order-checklist">
              <div class="order-checklist-header" @mousedown="startOrderChecklistDrag">
                <span>Pre-Trade Checklist ({{previewPosition?.side}})</span>
                <button class="order-checklist-close" @mousedown.stop @click="cancelOrderChecklist">×</button>
              </div>

              <div class="order-checklist-body">
                <div class="order-checklist-section buy" v-if="previewPosition && previewPosition.side === 'LONG'">
                  <div class="order-checklist-section-title">BUY</div>
                  <label class="order-checklist-item">
                    <input type="checkbox" v-model="orderChecklist.buy.nearEma200" />
                    <span>Price is near 15m EMA200</span>
                  </label>
                  <label class="order-checklist-item">
                    <input type="checkbox" v-model="orderChecklist.buy.avwapBreakUp" />
                    <span>Previous candle / current candle breaks the AVWAP upward</span>
                  </label>
                  <label class="order-checklist-item">
                    <input type="checkbox" v-model="orderChecklist.buy.avwapCrossBear" />
                    <span>Recent candle with crossedAvwapPoint is a bear side</span>
                  </label>
                  <label class="order-checklist-item">
                    <input type="checkbox" v-model="orderChecklist.buy.higherTfBelow" />
                    <span>Higher timeframe EMA is below 15M EMA</span>
                  </label>
                </div>

                <div class="order-checklist-section sell" v-else-if="previewPosition && previewPosition.side === 'SHORT'">
                  <div class="order-checklist-section-title">SELL</div>
                  <label class="order-checklist-item">
                    <input type="checkbox" v-model="orderChecklist.sell.nearEma200" />
                    <span>Price is near 15m EMA200</span>
                  </label>
                  <label class="order-checklist-item">
                    <input type="checkbox" v-model="orderChecklist.sell.avwapBreakDown" />
                    <span>Previous candle / current candle breaks the AVWAP downward</span>
                  </label>
                  <label class="order-checklist-item">
                    <input type="checkbox" v-model="orderChecklist.sell.avwapCrossBull" />
                    <span>Recent candle with crossedAvwapPoint is a bull side</span>
                  </label>
                  <label class="order-checklist-item">
                    <input type="checkbox" v-model="orderChecklist.sell.higherTfAbove" />
                    <span>Higher timeframe EMA is above 15M EMA</span>
                  </label>
                </div>
              </div>

              <div class="order-checklist-footer">
                <button class="order-checklist-btn cancel" @click="cancelOrderChecklist">Cancel</button>
                <button class="order-checklist-btn confirm" :disabled="placingOrder" @click="confirmOrderChecklist">
                  {{ placingOrder ? 'Placing…' : 'Confirm Order' }}
                </button>
              </div>
            </div>
          </foreignObject>
        </g>
      </svg>
    </div>

    <!-- Candle Details Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ (new Date(selectedCandle?.openTime!)).toLocaleString() }}</h2>
          <button class="close-btn" @click="closeModal">×</button>
        </div>

        <div class="modal-body">
          <div v-if="selectedCandle" class="candle-details">
            <div class="detail-grid">
              <!-- OHLC -->
              <div class="detail-item">
                <label>Open</label>
                <span>{{ selectedCandle.open!.toFixed(4) }}</span>
              </div>
              <div class="detail-item">
                <label>High</label>
                <span>{{ selectedCandle.high!.toFixed(4) }}</span>
              </div>
              <div class="detail-item">
                <label>Low</label>
                <span>{{ selectedCandle.low!.toFixed(4) }}</span>
              </div>
              <div class="detail-item">
                <label>Close</label>
                <span>{{ selectedCandle.close!.toFixed(4) }}</span>
              </div>
              <div class="detail-item">
                <label>Volume</label>
                <span>{{ selectedCandle.volume }}</span>
              </div>
              <div class="detail-item">
                <label>Status</label>
                <span>{{ selectedCandle.status }}</span>
              </div>

              <div class="detail-item">
                <label>Condition Met</label>
                <span>{{ selectedCandle.candleData?.conditionMet }}</span>
              </div>

              <div class="detail-item">
                <label>PNL</label>
                <span>{{ selectedCandle.pnl!.toFixed(4) }}</span>
              </div>

              <div class="detail-item">
                <label>Extra Info</label>
                <span>{{ selectedCandle.candleData!.extraInfo }}</span>
              </div>

              <!-- Price Zone -->
              <div v-if="selectedCandle.priceZone" class="detail-section">
                <h3>Price Zone</h3>
                <div class="detail-item">
                  <label>Upper</label>
                  <span>{{ selectedCandle.priceZone!.upper }}</span>
                </div>
                <div class="detail-item">
                  <label>Mid</label>
                  <span>{{ selectedCandle.priceZone!.mid }}</span>
                </div>
                <div class="detail-item">
                  <label>Lower</label>
                  <span>{{ selectedCandle.priceZone!.lower }}</span>
                </div>
              </div>

              <!-- Support/Resistance -->
              <div v-if="selectedCandle.support || selectedCandle.resistance" class="detail-section">
                <h3>Support/Resistance</h3>
                <div v-if="selectedCandle.support" class="detail-item">
                  <label>Support</label>
                  <span>{{ selectedCandle.support?.lower!.toFixed(4) }}</span>
                </div>
                <div v-if="selectedCandle.resistance" class="detail-item">
                  <label>Resistance</label>
                  <span>{{ selectedCandle.resistance?.upper!.toFixed(4) }}</span>
                </div>
              </div>

              <!-- Trading Info -->
              <div v-if="selectedCandle.tpPrice || selectedCandle.slPrice || selectedCandle.side" class="detail-section">
                <h3>Trading Info</h3>
                <div v-if="selectedCandle.tpPrice" class="detail-item">
                  <label>TP Price</label>
                  <span>{{ selectedCandle.tpPrice.toFixed(4) }}</span>
                </div>
                <div v-if="selectedCandle.slPrice" class="detail-item">
                  <label>SL Price</label>
                  <span>{{ selectedCandle.slPrice.toFixed(4) }}</span>
                </div>
                <div v-if="selectedCandle.side" class="detail-item">
                  <label>Side</label>
                  <span :class="`side-badge side-${selectedCandle.side.toLowerCase()}`">{{ selectedCandle.side }}</span>
                </div>
              </div>

              <!-- Candle Data -->
              <div v-if="selectedCandle.candleData" class="detail-section">
                <h3>Candle Data</h3>
                <div v-for="(value, key) in selectedCandle.candleData" :key="key">
                  <template v-if="typeof value === 'object' && value !== null">
                    <div class="nested-section">
                      <h4>{{ key }}</h4>
                      <div v-for="(nestedValue, nestedKey) in value" :key="`${key}-${nestedKey}`" class="detail-item nested">
                        <label>{{ nestedKey }}</label>
                        <span>{{ formatValue(nestedValue) }}</span>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="detail-item">
                      <label>{{ key }}</label>
                      <span>{{ formatValue(value) }}</span>
                    </div>
                  </template>
                </div>
              </div>

              <!-- Status -->
              <div v-if="selectedCandle.status" class="detail-section">
                <h3>Status</h3>
                <div class="detail-item">
                  <label>Status</label>
                  <span :class="`status-badge status-${selectedCandle.status.toLowerCase()}`">{{ selectedCandle.status }}</span>
                </div>
              </div>

              <!-- Other Properties -->
              <div v-if="Object.keys(otherProps).length > 0" class="detail-section">
                <h3>Additional Properties</h3>
                <div v-for="(value, key) in otherProps" :key="key">
                  <template v-if="typeof value === 'object' && value !== null">
                    <div class="nested-section">
                      <h4>{{ key }}</h4>
                      <div v-for="(nestedValue, nestedKey) in value" :key="`${key}-${nestedKey}`" class="detail-item nested">
                        <label>{{ nestedKey }}</label>
                        <span>{{ formatValue(nestedValue) }}</span>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="detail-item">
                      <label>{{ key }}</label>
                      <span>{{ formatValue(value) }}</span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <DialogComponent v-model="showKeyLevels" :width="'95vw'">
        <DialogHeaderComponent>
            {{ symbol }}
        </DialogHeaderComponent>
        <KeyLevelVisualizerComponent 
          :symbol="symbol"
          :bid-wall="largestBidWall?.price"
          :ask-wall="lowestAskWall?.price"
          :side="previewPosition?.side ?? null"
          :tp-price="previewPosition?.tpPrice"
          :sl-price="previewPosition?.slPrice"
          />
    </DialogComponent>

  <!-- MA structure / crossing analysis dialog -->
  <DialogComponent v-model="showMaCrossing" :width="'95vw'">
        <DialogHeaderComponent>
            {{ props.symbol.toUpperCase() }} · MA Structure
        </DialogHeaderComponent>
        <MACrossingVisualizerComponent :symbol="props.symbol" />
    </DialogComponent>

  <!-- Accumulation analysis dialog -->
  <DialogComponent v-model="showAccumulationAnalysis">
        <DialogHeaderComponent>
            {{ props.symbol.toUpperCase() }} · Accumulation Scan
        </DialogHeaderComponent>
        <AccumulationAnalysisResultComponent v-if="showAccumulationAnalysis" :symbol="props.symbol" />
    </DialogComponent>

  <!-- FRVP confluence analysis dialog -->
  <DialogComponent v-model="showFrvpAnalysis" :width="'900px'">
    <DialogHeaderComponent>
      {{ props.symbol.toUpperCase() }} · FRVP Market Analysis
    </DialogHeaderComponent>

    <div style="max-height:90vh;overflow:auto;">
      <div v-if="frvpAnalysisResult" class="frvp-analysis">
        <div class="frvp-analysis-meta">
          <span>Symbol: {{ frvpAnalysisResult.symbol }}</span>
          <span>Interval: {{ frvpAnalysisResult.interval }}</span>
          <span>Zones analyzed: {{ frvpAnalysisResult.zonesAnalyzed }}</span>
          <span>OI coverage: {{ frvpAnalysisResult.oiCoverage.withOi }} / {{ frvpAnalysisResult.oiCoverage.total }}</span>
        </div>

        <div class="frvp-bias-card" :class="`frvp-bias-${frvpAnalysisResult.bias.toLowerCase()}`">
          <div class="frvp-bias-label">{{ frvpAnalysisResult.bias }}</div>
          <div class="frvp-bias-confidence">
            {{ frvpAnalysisResult.confidencePct }}% CONFIDENCE
            <span class="frvp-bias-strength">({{ frvpAnalysisResult.biasStrength.replace('_', ' ') }})</span>
          </div>
          <div class="frvp-bias-caveat">Directional bias — not probability of profit</div>
        </div>

        <div v-if="frvpAnalysisResult.reasons.length" class="frvp-section">
          <h4>Why?</h4>
          <ul class="frvp-reason-list">
            <li v-for="(r, i) in frvpAnalysisResult.reasons" :key="`frvp-reason-${i}`">✓ {{ r }}</li>
          </ul>
        </div>

        <div v-if="frvpAnalysisResult.warnings.length" class="frvp-section">
          <h4>Risk / Contradictions</h4>
          <ul class="frvp-warning-list">
            <li v-for="(w, i) in frvpAnalysisResult.warnings" :key="`frvp-warn-${i}`">⚠ {{ w }}</li>
          </ul>
        </div>

        <div class="frvp-section">
          <h4>Current FRVP Structure</h4>
          <div class="frvp-badges">
            <span class="frvp-badge">Price Direction: {{ frvpAnalysisResult.currentStructure.priceDirection }}</span>
            <span class="frvp-badge">POC Position: {{ frvpAnalysisResult.currentStructure.pocPositionBand }}</span>
            <span class="frvp-badge">Close vs POC: {{ frvpAnalysisResult.currentStructure.closePocRelation }}</span>
            <span class="frvp-badge">Displacement: {{ frvpAnalysisResult.currentStructure.pocDisplacementBand }}</span>
            <span class="frvp-badge">
              HVN: {{ frvpAnalysisResult.currentStructure.hvnStructure }} ({{ frvpAnalysisResult.currentStructure.hvnSpread }})
            </span>
            <span class="frvp-badge">Edges: {{ frvpAnalysisResult.currentStructure.edgeThickness }}</span>
            <span class="frvp-badge">
              OI: {{ frvpAnalysisResult.currentStructure.oiRegime }}
              <template v-if="frvpAnalysisResult.currentStructure.oiChangePct !== null">
                ({{ frvpAnalysisResult.currentStructure.oiChangePct!.toFixed(2) }}%)
              </template>
            </span>
          </div>
        </div>

        <div class="frvp-section">
          <h4>Pattern Detected: {{ frvpAnalysisResult.patternDetected }}</h4>
          <p class="frvp-pattern-explanation">{{ frvpAnalysisResult.patternExplanation }}</p>
        </div>

        <div class="frvp-section">
          <h4>Historical Validation</h4>
          <p v-if="frvpAnalysisResult.historicalValidation.insufficientSample" class="frvp-hist-unavailable">
            Historical validation unavailable — only {{ frvpAnalysisResult.historicalValidation.comparableSetups }}
            comparable setup(s) found.
          </p>
          <p v-else>
            Similar setups: {{ frvpAnalysisResult.historicalValidation.comparableSetups }} ·
            Correct: {{ frvpAnalysisResult.historicalValidation.correct }} ·
            Historical hit rate: {{ frvpAnalysisResult.historicalValidation.accuracy }}%
          </p>
        </div>

        <div class="frvp-section">
          <h4>Zone-by-Zone Analysis</h4>
          <details
            v-for="(z, i) in frvpAnalysisResult.zones"
            :key="`frvp-zone-${z.id}`"
            class="frvp-zone-detail"
            :open="i === frvpAnalysisResult.zones.length - 1"
          >
            <summary>
              Zone {{ String(i + 1).padStart(2, '0') }} — {{ z.structure.priceDirection }}
              {{ z.structure.priceChangePct.toFixed(2) }}% · {{ z.signal }} · {{ z.patternLabel }}
            </summary>
            <div class="frvp-zone-body">
              <div>Price: {{ z.structure.priceDirection }} {{ z.structure.priceChangePct.toFixed(2) }}%</div>
              <div>POC: {{ z.structure.pocPositionBand }}</div>
              <div>Close vs POC: {{ z.structure.closePocRelation }}</div>
              <div>Displacement: {{ z.structure.pocDisplacementBand }}</div>
              <div>HVN: {{ z.structure.hvnStructure }} ({{ z.structure.hvnSpread }})</div>
              <div>Edges: {{ z.structure.edgeThickness }}</div>
              <div>
                OI: {{ z.structure.oiRegime }}
                <template v-if="z.structure.oiChangePct !== null">({{ z.structure.oiChangePct!.toFixed(2) }}%)</template>
              </div>
              <div>Signal: {{ z.signal }} BIAS</div>
              <div v-if="z.nextZone">
                Next zone: {{ z.nextZone.actualDirection }}
                <span v-if="z.nextZone.predictedCorrect === true" class="frvp-hit">(prediction correct)</span>
                <span v-else-if="z.nextZone.predictedCorrect === false" class="frvp-miss">(prediction missed)</span>
              </div>
              <div>Pattern: {{ z.patternLabel }}</div>
            </div>
          </details>
        </div>

        <div class="frvp-section frvp-narrative">
          <p>{{ frvpAnalysisResult.narrative }}</p>
        </div>
      </div>

      <div v-else class="frvp-analysis-empty">
        Place at least one FRVP on the chart, then click "Analyze FRVPs".
      </div>
    </div>
  </DialogComponent>

  <!-- Range Download scalp analysis dialog -->
  <DialogComponent v-model="showRangeAnalysis" :width="'900px'">
    <DialogHeaderComponent>
      {{ props.symbol.toUpperCase() }} · Range Scalp Analysis
    </DialogHeaderComponent>

    <div style="max-height:90vh;overflow:auto;">
      <div v-if="rangeAnalysisLoading" class="range-analysis-empty">
        Analyzing range…
      </div>

      <div v-else-if="rangeAnalysisError" class="range-analysis-empty range-analysis-error">
        {{ rangeAnalysisError }}
      </div>

      <div v-else-if="rangeAnalysisResult" class="range-analysis">
        <div class="range-analysis-meta">
          <span>Symbol: {{ rangeAnalysisResult.symbol }}</span>
          <span>Interval: {{ rangeAnalysisResult.interval }}</span>
          <span>Time: {{ rangeAnalysisResult.lastCandleTimePht }}</span>
          <span>Last Price: {{ rangeAnalysisResult.lastPrice }}</span>
        </div>

        <div class="range-bias-card" :class="`range-bias-${rangeAnalysisResult.bias.toLowerCase()}`">
          <div class="range-bias-label">{{ rangeAnalysisResult.bias }}</div>
          <div class="range-bias-confidence">{{ rangeAnalysisResult.confidence }}% CONFIDENCE</div>
          <div class="range-bias-caveat">Structural read — not a guaranteed outcome</div>
        </div>

        <!-- Preview position TP-hit confidence — only when a Preview Buy/Sell is active -->
        <div v-if="rangeAnalysisResult.position" class="range-position-card" :class="`range-position-${rangeAnalysisResult.position.side.toLowerCase()}`">
          <div class="range-position-header">
            <span class="range-position-side">{{ rangeAnalysisResult.position.side }} PREVIEW</span>
            <span
              class="range-position-alignment"
              :class="`range-align-${rangeAnalysisResult.position.alignment.toLowerCase()}`"
            >
              {{ rangeAnalysisResult.position.alignment }} vs structure
            </span>
          </div>
          <div class="range-position-confidence">
            {{ rangeAnalysisResult.position.tpHitConfidence }}%
            <span class="range-position-confidence-label">confidence to hit TP</span>
          </div>
          <div class="range-trade-card">
            <div class="range-trade-row">
              <span class="range-trade-label">Entry</span>
              <span>{{ rangeAnalysisResult.position.entryPrice }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">TP</span>
              <span>{{ rangeAnalysisResult.position.tpPrice }} ({{ rangeAnalysisResult.position.tpDistancePercent.toFixed(2) }}%)</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">SL</span>
              <span>{{ rangeAnalysisResult.position.slPrice }} ({{ rangeAnalysisResult.position.slDistancePercent.toFixed(2) }}%)</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">R:R</span>
              <span>{{ rangeAnalysisResult.position.riskReward.toFixed(2) }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Entry Quality</span>
              <span class="range-entry-quality" :class="`range-eq-${rangeAnalysisResult.position.entryQuality.toLowerCase()}`">
                {{ rangeAnalysisResult.position.entryQuality.replace('_', ' ') }}
              </span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">TP Placement</span>
              <span>{{ rangeAnalysisResult.position.tpRealism.replace(/_/g, ' ') }}</span>
            </div>
          </div>
          <p class="range-position-thesis">{{ rangeAnalysisResult.position.thesis }}</p>
          <ul v-if="rangeAnalysisResult.position.obstacles.length" class="range-warning-list">
            <li v-for="(o, i) in rangeAnalysisResult.position.obstacles" :key="`range-obstacle-${i}`">⚠ {{ o }}</li>
          </ul>
        </div>

        <div v-if="rangeAnalysisResult.bias !== 'NEUTRAL'" class="range-trade-card">
          <div class="range-trade-row">
            <span class="range-trade-label">Analyzer's Own Direction</span>
            <span>{{ rangeAnalysisResult.bias }}</span>
          </div>
          <div class="range-trade-row">
            <span class="range-trade-label">Entry</span>
            <span>{{ rangeAnalysisResult.entryReference ?? '—' }}</span>
          </div>
          <div class="range-trade-row">
            <span class="range-trade-label">TP</span>
            <span>{{ rangeAnalysisResult.takeProfit ?? 'no clear target found' }}</span>
          </div>
          <div class="range-trade-row">
            <span class="range-trade-label">SL</span>
            <span>{{ rangeAnalysisResult.stopLoss ?? 'no clear invalidation found' }}</span>
          </div>
          <div class="range-trade-row">
            <span class="range-trade-label">R:R</span>
            <span>{{ rangeAnalysisResult.riskReward !== null ? rangeAnalysisResult.riskReward.toFixed(2) : '—' }}</span>
          </div>
          <div class="range-trade-row">
            <span class="range-trade-label">Entry Quality</span>
            <span class="range-entry-quality" :class="`range-eq-${rangeAnalysisResult.entryQuality.toLowerCase()}`">
              {{ rangeAnalysisResult.entryQuality.replace('_', ' ') }}
            </span>
          </div>
        </div>

        <div class="range-section">
          <h4>Short-Term Thesis</h4>
          <p class="range-thesis">{{ rangeAnalysisResult.thesis }}</p>
        </div>

        <div v-if="rangeAnalysisResult.supportingSignals.length" class="range-section">
          <h4>Supporting Signals</h4>
          <ul class="range-reason-list">
            <li v-for="(r, i) in rangeAnalysisResult.supportingSignals" :key="`range-support-${i}`">✓ {{ r }}</li>
          </ul>
        </div>

        <div v-if="rangeAnalysisResult.contradictingSignals.length" class="range-section">
          <h4>Contradicting Signals</h4>
          <ul class="range-warning-list">
            <li v-for="(w, i) in rangeAnalysisResult.contradictingSignals" :key="`range-contra-${i}`">⚠ {{ w }}</li>
          </ul>
        </div>

        <div class="range-section">
          <h4>Price Action</h4>
          <p>{{ rangeAnalysisResult.priceAction.description }}</p>
        </div>

        <div class="range-section">
          <h4>EMA200</h4>
          <p>{{ rangeAnalysisResult.trend.description }}</p>
        </div>

        <div class="range-section">
          <h4>Open Interest</h4>
          <p>{{ rangeAnalysisResult.openInterest.description }}</p>
        </div>

        <div class="range-section">
          <h4>Long/Short</h4>
          <p>{{ rangeAnalysisResult.longShort.description }}</p>
        </div>

        <div class="range-section">
          <h4>AVWAP</h4>
          <p>{{ rangeAnalysisResult.avwap.description }}</p>
        </div>

        <div class="range-section">
          <h4>FRVP</h4>
          <p>{{ rangeAnalysisResult.frvp.description }}</p>
        </div>

        <div class="range-section">
          <h4>Risk / Invalidation</h4>
          <p>{{ rangeAnalysisResult.risk }}</p>
        </div>
      </div>

      <div v-else class="range-analysis-empty">
        Draw a Range Download box on the chart, then click "▶ Analyze".
      </div>
    </div>
  </DialogComponent>

  <!-- Range Investigate dialog -->
  <DialogComponent v-model="showRangeInvestigate" :width="'900px'">
    <DialogHeaderComponent>
      {{ props.symbol.toUpperCase() }} · Range Investigate
    </DialogHeaderComponent>

    <div style="max-height:90vh;overflow:auto;">
      <div v-if="rangeInvestigateLoading" class="range-analysis-empty">
        Investigating range… (pulling large trades + funding rate)
      </div>

      <div v-else-if="rangeInvestigateError" class="range-analysis-empty range-analysis-error">
        {{ rangeInvestigateError }}
      </div>

      <div v-else-if="rangeInvestigateResult" class="range-analysis">
        <div class="range-analysis-meta">
          <span>Symbol: {{ rangeInvestigateResult.symbol }}</span>
          <span>Interval: {{ rangeInvestigateResult.interval }}</span>
          <span>Range: {{ rangeInvestigateResult.rangeStartTimeIso }} → {{ rangeInvestigateResult.rangeEndTimeIso }}</span>
        </div>

        <!-- Driver identification -->
        <div class="range-bias-card" :class="`investigate-driver-${rangeInvestigateResult.dominantDriver.toLowerCase().replace(/_/g,'-')}`">
          <div class="range-bias-label investigate-driver-label">{{ rangeInvestigateResult.dominantDriver.replace(/_/g, ' ') }}</div>
          <div class="range-bias-confidence">{{ rangeInvestigateResult.driverConfidence }}% CONFIDENCE</div>
          <div class="range-bias-caveat">Best-fit explanation from available data — not a certainty</div>
        </div>

        <div class="range-section">
          <h4>Why This Happened</h4>
          <p class="range-thesis">{{ rangeInvestigateResult.whyItHappened }}</p>
        </div>

        <div v-if="rangeInvestigateResult.supportingSignals.length" class="range-section">
          <h4>Supporting Signals</h4>
          <ul class="range-reason-list">
            <li v-for="(s, i) in rangeInvestigateResult.supportingSignals" :key="`inv-support-${i}`">✓ {{ s }}</li>
          </ul>
        </div>

        <div v-if="rangeInvestigateResult.contradictingSignals.length" class="range-section">
          <h4>Contradicting / Caution Signals</h4>
          <ul class="range-warning-list">
            <li v-for="(s, i) in rangeInvestigateResult.contradictingSignals" :key="`inv-contra-${i}`">⚠ {{ s }}</li>
          </ul>
        </div>

        <!-- Prediction metrics -->
        <div class="investigate-prediction-card" :class="`investigate-verdict-${rangeInvestigateResult.prediction.verdict.toLowerCase()}`">
          <div class="investigate-prediction-header">
            <span class="investigate-prediction-verdict">{{ rangeInvestigateResult.prediction.verdict }}</span>
            <span class="investigate-prediction-confidence">{{ rangeInvestigateResult.prediction.confidence }}% confidence</span>
          </div>

          <div class="investigate-prediction-bars">
            <div class="investigate-prediction-bar-row">
              <span class="investigate-prediction-bar-label">Continuation</span>
              <div class="investigate-prediction-bar-track">
                <div class="investigate-prediction-bar-fill investigate-bar-continuation" :style="{ width: rangeInvestigateResult.prediction.continuationPercent + '%' }" />
              </div>
              <span class="investigate-prediction-bar-value">{{ rangeInvestigateResult.prediction.continuationPercent }}%</span>
            </div>
            <div class="investigate-prediction-bar-row">
              <span class="investigate-prediction-bar-label">Pullback</span>
              <div class="investigate-prediction-bar-track">
                <div class="investigate-prediction-bar-fill investigate-bar-pullback" :style="{ width: rangeInvestigateResult.prediction.pullbackPercent + '%' }" />
              </div>
              <span class="investigate-prediction-bar-value">{{ rangeInvestigateResult.prediction.pullbackPercent }}%</span>
            </div>
            <div class="investigate-prediction-bar-row">
              <span class="investigate-prediction-bar-label">Reversal</span>
              <div class="investigate-prediction-bar-track">
                <div class="investigate-prediction-bar-fill investigate-bar-reversal" :style="{ width: rangeInvestigateResult.prediction.reversalPercent + '%' }" />
              </div>
              <span class="investigate-prediction-bar-value">{{ rangeInvestigateResult.prediction.reversalPercent }}%</span>
            </div>
          </div>

          <p class="range-position-thesis">{{ rangeInvestigateResult.prediction.thesis }}</p>
          <p class="investigate-invalidation">Invalidation: {{ rangeInvestigateResult.prediction.invalidation }}</p>
        </div>

        <!-- Preview position alignment, if a preview is active -->
        <div v-if="rangeInvestigateResult.position" class="range-position-card" :class="`range-position-${rangeInvestigateResult.position.side.toLowerCase()}`">
          <div class="range-position-header">
            <span class="range-position-side">{{ rangeInvestigateResult.position.side }} PREVIEW</span>
            <span
              class="range-position-alignment"
              :class="`range-align-${rangeInvestigateResult.position.alignment.toLowerCase()}`"
            >
              {{ rangeInvestigateResult.position.alignment }} vs read
            </span>
          </div>
          <p class="range-position-thesis">{{ rangeInvestigateResult.position.note }}</p>
        </div>

        <!-- Raw metrics -->
        <div class="range-section">
          <h4>Metrics</h4>
          <div class="range-trade-card">
            <div class="range-trade-row">
              <span class="range-trade-label">Move</span>
              <span>{{ rangeInvestigateResult.metrics.priceMovePercent.toFixed(2) }}% ({{ rangeInvestigateResult.metrics.direction }})</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Volume vs baseline</span>
              <span>{{ rangeInvestigateResult.metrics.volumeVsBaselineRatio != null ? rangeInvestigateResult.metrics.volumeVsBaselineRatio.toFixed(2) + 'x' : '—' }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">OI change</span>
              <span>{{ rangeInvestigateResult.metrics.oiChangePercent != null ? rangeInvestigateResult.metrics.oiChangePercent.toFixed(2) + '%' : '—' }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Long/Short shift</span>
              <span>{{ rangeInvestigateResult.metrics.longAccountChangePercent != null ? rangeInvestigateResult.metrics.longAccountChangePercent.toFixed(2) + '%' : '—' }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Funding rate</span>
              <span>{{ rangeInvestigateResult.metrics.fundingRatePercent != null ? rangeInvestigateResult.metrics.fundingRatePercent.toFixed(4) + '%' : '—' }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Taker buy/sell ratio</span>
              <span>{{ rangeInvestigateResult.metrics.takerBuySellRatio != null ? rangeInvestigateResult.metrics.takerBuySellRatio.toFixed(2) : '—' }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Largest single trade</span>
              <span>{{ rangeInvestigateResult.metrics.largestTradeNotional != null ? '$' + rangeInvestigateResult.metrics.largestTradeNotional.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—' }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Close position in range</span>
              <span>{{ rangeInvestigateResult.metrics.closePositionInRange != null ? (rangeInvestigateResult.metrics.closePositionInRange * 100).toFixed(0) + '%' : '—' }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Distance from EMA200</span>
              <span>{{ rangeInvestigateResult.metrics.distanceFromEma200Percent != null ? rangeInvestigateResult.metrics.distanceFromEma200Percent.toFixed(2) + '%' : '—' }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Inflow / Outflow</span>
              <span>{{ formatNotional(rangeInvestigateResult.metrics.totalInflow) }} / {{ formatNotional(rangeInvestigateResult.metrics.totalOutflow) }}</span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Flow vs baseline</span>
              <span>
                <template v-if="rangeInvestigateResult.metrics.flowSpike === 'INFLOW_SPIKE'">
                  Inflow ~{{ rangeInvestigateResult.metrics.inflowVsBaselineRatio?.toFixed(1) }}x spike
                </template>
                <template v-else-if="rangeInvestigateResult.metrics.flowSpike === 'OUTFLOW_SPIKE'">
                  Outflow ~{{ rangeInvestigateResult.metrics.outflowVsBaselineRatio?.toFixed(1) }}x spike
                </template>
                <template v-else>—</template>
              </span>
            </div>
            <div class="range-trade-row">
              <span class="range-trade-label">Flow confluence</span>
              <span :class="`investigate-flow-${rangeInvestigateResult.metrics.flowConfluence.toLowerCase()}`">
                {{ rangeInvestigateResult.metrics.flowConfluence }}
              </span>
            </div>
          </div>
        </div>

        <!-- Download: investigation_result + investigation_range + after_the_fact_range -->
        <div class="range-section range-inv-download-section">
          <h4>Export</h4>
          <div class="range-inv-download-row">
            <button class="range-inv-download-btn" @click="downloadInvestigateData">
              ⬇ Download Data
            </button>
            <span class="range-inv-download-note">
              <template v-if="currentInvestigateBox && currentInvestigateBox.resultEndIndex !== null && currentInvestigateBox.resultEndIndex > currentInvestigateBox.endIndex">
                Includes the after-the-fact range — {{ currentInvestigateBox.resultEndIndex - currentInvestigateBox.endIndex }} candle(s) following this range.
              </template>
              <template v-else>
                No Result Range set yet — download will only include the investigated range. Use "➕ Result Range" on the chart to also capture what happened after.
              </template>
            </span>
          </div>
        </div>
      </div>

      <div v-else class="range-analysis-empty">
        Draw a Range Investigate box on the chart, then click "🔍 Investigate".
      </div>
    </div>
  </DialogComponent>

  <!-- Wallet Movement detail dialog -->
  <DialogComponent v-model="showMovementDetail" :width="'700px'">
    <DialogHeaderComponent>
      {{ props.symbol.toUpperCase() }} · Wallet Movement<template v-if="selectedMovementCandleIndex !== null"> — Candle {{ selectedMovementCandleIndex + 1 }}</template>
    </DialogHeaderComponent>

    <div class="movement-detail-body" style="max-height:80vh;overflow:auto;">
      <div v-if="selectedMovementCandle" class="movement-detail-meta">
        <span>Open: {{ new Date(selectedMovementCandle.openTime!).toISOString() }}</span>
        <span>Close: {{ new Date(selectedMovementCandle.openTime! + intervalToMs(props.interval)).toISOString() }}</span>
      </div>

      <div v-if="selectedMovementBucket" class="movement-detail-summary">
        <div class="movement-detail-summary-item movement-inflow-total">
          Inflow total: {{ formatNotional(selectedMovementBucket.inflow) }}
        </div>
        <div class="movement-detail-summary-item movement-outflow-total">
          Outflow total: {{ formatNotional(selectedMovementBucket.outflow) }}
        </div>
        <div class="movement-detail-summary-item">
          Net: {{ formatNotional(selectedMovementBucket.inflow - selectedMovementBucket.outflow) }}
        </div>
      </div>

      <div v-if="selectedMovementBucket && selectedMovementBucket.records.length > 0" class="movement-detail-list">
        <div
          v-for="(rec, i) in selectedMovementBucket.records"
          :key="`movement-rec-${i}`"
          :class="['movement-detail-row', rec.type === 'INFLOW' ? 'movement-row-inflow' : 'movement-row-outflow']"
        >
          <span :class="['side-badge', rec.type === 'INFLOW' ? 'side-long' : 'side-short']">{{ rec.type }}</span>
          <span class="movement-detail-amount">{{ rec.amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) }} {{ rec.symbol }}</span>
          <span class="movement-detail-addr">{{ rec.from_address.slice(0, 8) }}…{{ rec.from_address.slice(-6) }} → {{ rec.to_address.slice(0, 8) }}…{{ rec.to_address.slice(-6) }}</span>
          <span class="movement-detail-time">{{ rec.timestamp }}</span>
          <a
            class="movement-detail-tx"
            :href="`https://etherscan.io/tx/${rec.tx_hash}`"
            target="_blank"
            rel="noopener noreferrer"
          >
            tx ↗
          </a>
        </div>
      </div>

      <div v-else class="movement-detail-empty">
        No wallet movement recorded for this candle.
      </div>
    </div>
  </DialogComponent>

  <!-- Summarize Movement dialog -->
  <DialogComponent v-model="showMovementSummary" :width="'820px'">
    <DialogHeaderComponent>
      {{ props.symbol.toUpperCase() }} · Summarize Movement
      <template v-if="movementSummaryResult"> — {{ movementSummaryResult.candleCount }} candles</template>
    </DialogHeaderComponent>

    <div class="movement-summary-body" style="max-height:80vh;overflow:auto;">
      <div v-if="movementSummaryResult" class="movement-summary">
        <div class="range-meta-row">
          <span>Symbol: {{ movementSummaryResult.symbol }}</span>
          <span>Interval: {{ movementSummaryResult.interval }}</span>
          <span>Range: {{ movementSummaryResult.rangeStartTimeIso }} → {{ movementSummaryResult.rangeEndTimeIso }}</span>
        </div>

        <!-- Overall totals -->
        <div class="movement-detail-summary movement-summary-totals">
          <div class="movement-detail-summary-item movement-inflow-total">
            Total Inflow: {{ formatNotional(movementSummaryResult.totalInflow) }}
          </div>
          <div class="movement-detail-summary-item movement-outflow-total">
            Total Outflow: {{ formatNotional(movementSummaryResult.totalOutflow) }}
          </div>
          <div class="movement-detail-summary-item">
            Net: {{ movementSummaryResult.net >= 0 ? '+' : '' }}{{ formatNotional(movementSummaryResult.net) }}
          </div>
        </div>

        <!-- Single horizontal bar chart: total inflow vs total outflow -->
        <div v-if="movementSummaryResult.maxTotal > 0" class="movement-summary-chart">
          <div class="movement-summary-bar-row">
            <span class="movement-summary-bar-label">Inflow</span>
            <div class="movement-summary-bar-track">
              <div
                class="movement-summary-bar-fill movement-summary-bar-inflow"
                :style="{ width: (movementSummaryResult.totalInflow / movementSummaryResult.maxTotal * 100) + '%' }"
              />
            </div>
            <span class="movement-summary-bar-value movement-inflow-total">{{ formatNotional(movementSummaryResult.totalInflow) }}</span>
          </div>
          <div class="movement-summary-bar-row">
            <span class="movement-summary-bar-label">Outflow</span>
            <div class="movement-summary-bar-track">
              <div
                class="movement-summary-bar-fill movement-summary-bar-outflow"
                :style="{ width: (movementSummaryResult.totalOutflow / movementSummaryResult.maxTotal * 100) + '%' }"
              />
            </div>
            <span class="movement-summary-bar-value movement-outflow-total">{{ formatNotional(movementSummaryResult.totalOutflow) }}</span>
          </div>
        </div>

        <div v-else class="movement-detail-empty">
          No wallet movement recorded across this range. Try "See Movement" first to load data for the visible candles.
        </div>
      </div>

      <div v-else class="movement-detail-empty">
        No range selected.
      </div>
    </div>
  </DialogComponent>

  <!-- Add price line dialog -->
  <DialogComponent v-model="showLineDialog" :width="'420px'">
    <DialogHeaderComponent>
      Add Price Line
    </DialogHeaderComponent>

    <div class="line-dialog-body">
      <label class="line-dialog-field">
        <span>Price</span>
        <input
          v-model.number="lineDraftPrice"
          type="number"
          step="any"
          class="line-dialog-input"
          @keyup.enter="confirmLineDraft"
        />
      </label>

      <label class="line-dialog-field">
        <span>Label (optional)</span>
        <input
          v-model="lineDraftLabel"
          type="text"
          placeholder="e.g. Resistance"
          class="line-dialog-input"
          @keyup.enter="confirmLineDraft"
        />
      </label>

      <div class="line-dialog-actions">
        <button class="line-dialog-btn line-dialog-btn-cancel" @click="cancelLineDraft">Cancel</button>
        <button class="line-dialog-btn line-dialog-btn-confirm" @click="confirmLineDraft">Add Line</button>
      </div>
    </div>
  </DialogComponent>
</template>

<script setup lang="ts">
import type { CandleEntry, FuturesSymbol } from '@/core/interfaces';
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
// NOTE: adjust this import path to wherever OrderMakerUtility actually lives in your project
import { OrderMakerUtility } from '@/utility/OrderMakerUtility';
// NOTE: adjust this import path to wherever useNotificationStore actually lives in your project
import { useNotificationStore } from '@/stores/notificationStore.ts';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import KeyLevelVisualizerComponent from './KeyLevelVisualizerComponent.vue';
import MACrossingVisualizerComponent from './MACrossingVisualizerComponent.vue';
import AccumulationAnalysisResultComponent from './AccumulationAnalysisResultComponent.vue';
import { getOpenInterestRateForRange, type OpenInterestRangeRate } from '@/utility/accumulationAnalysis.ts';
import { analyzeFrvps, type FrvpAnalysisResult, type FrvpZoneInput } from '@/utility/analyzeFrvps';
import { analyzeRange, type RangeAnalysisResult, type RangeAnalysisInput } from '@/utility/rangeAnalyze';
import { investigateRange, type RangeInvestigateResult, type RangeInvestigateInput, type LargeTradeInput } from '@/utility/rangeInvestigate';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore.ts';
import { isElementAccessExpression } from 'typescript';
import { candleAnalyzer } from '@/utility/candleAnalyzerUtility.ts';

var chocomintoStore = useChocoMintoStore();
// ─── Binance kline stream message shape ───────────────────────────────────────
interface BinanceKline {
  t: number   // Kline open time (ms)
  T: number   // Kline close time (ms)
  o: string   // Open price
  h: string   // High price
  l: string   // Low price
  c: string   // Close price
  v: string   // Base asset volume
  x: boolean  // Is this kline closed?
}

interface BinanceKlineMessage {
  e: 'kline'
  E: number
  s: string
  k: BinanceKline
}

// ─── Binance diff depth stream message shape ──────────────────────────────────
// wss://fstream.binance.com/ws/<symbol>@depth  (or @depth@100ms for faster updates)
// Full order book management protocol (futures):
// https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Diff-Book-Depth-Streams
interface BinanceDepthMessage {
  e?: string      // "depthUpdate"
  E?: number      // Event time
  T?: number      // Transaction time
  s?: string      // Symbol
  U?: number      // First update ID in event
  u?: number      // Final update ID in event
  pu?: number     // Previous event's final update ID (futures only) — used for gap detection
  b: string[][]   // bids to be updated: [price, qty][]
  a: string[][]   // asks to be updated: [price, qty][]
}

// REST snapshot shape: GET https://fapi.binance.com/fapi/v1/depth?symbol=...&limit=1000
interface BinanceDepthSnapshot {
  lastUpdateId: number
  E?: number
  T?: number
  bids: string[][]
  asks: string[][]
}

// ─── Wallet movement (exchange inflow/outflow) API shape ──────────────────────
// GET {WALLET_MOVEMENT_API_BASE}/api/movement?symbol=...&start=ISO&end=ISO
// See whale_tracker_api.py — returns a flat array of raw transfers, newest first.
interface WalletMovement {
  amount: number
  from_address: string
  to_address: string
  symbol: string
  timestamp: string
  tx_hash: string
  type: 'INFLOW' | 'OUTFLOW'
}

// ─── Props ────────────────────────────────────────────────────────────────────
/** Most recent candle where price crossed the anchored VWAP — set upstream, same as candleData.isAvwapPoint. `direction` is which way price crossed it; `side` is whether the crossing candle itself closed bullish or bearish. */
interface CrossedAvwapPoint {
  direction: 'up' | 'down'
  side: 'bull' | 'bear'
}

interface Props {
  candles: CandleEntry[]
  /** e.g. 'btcusdt' — must be lowercase for Binance stream name */
  symbol?: string
  /** Kline interval, must match the interval of the candles you're passing in */
  interval?: string
  /** Most recent AVWAP cross point, used to pre-fill the order checklist. */
  crossedAvwapPoint?: CrossedAvwapPoint | null
}

const props = withDefaults(defineProps<Props>(), {
  symbol: 'btcusdt',
  interval: '15m',
})

// ─── State ────────────────────────────────────────────────────────────────────
const selectedCandleIndex = ref<number | null>(null)
const showModal = ref(false)
const hoveredCandleIndex = ref<number | null>(null)
const candleWidth = ref(8)
const connectVolumeSpikesvSpikes = ref(true)
const showVolume = ref(true)
const showOiBar = ref(false)
const showMovementPanel = ref(false)
const showMovementDetail = ref(false)
const selectedMovementCandleIndex = ref<number | null>(null)
const showEma = ref(true)
const showMa = ref(false)
const candleGap = 5
const svgHeight = 600
const CANDLES_PER_ZONE = 24
const minCandleWidth = 8
const maxCandleWidth = 50
const zoomSensitivity = 0.1
const SR_SPAN = 3

const chartContainer = ref<HTMLElement | null>(null)
const crosshairGroup = ref<SVGGElement | null>(null)
const priceRangeMin = ref(0)
const priceRangeMax = ref(0)
let isAdjustingHeight = false
let isDraggingChart = false

const showKeyLevels = ref(false);
const showMaCrossing = ref(false);
const showAccumulationAnalysis = ref(false);
const showFrvpAnalysis = ref(false);
const frvpAnalysisResult = ref<FrvpAnalysisResult | null>(null);

const showRangeAnalysis = ref(false);
const rangeAnalysisResult = ref<RangeAnalysisResult | null>(null);
const rangeAnalysisLoading = ref(false);
const rangeAnalysisError = ref<string | null>(null);

const showRangeInvestigate = ref(false);
const rangeInvestigateResult = ref<RangeInvestigateResult | null>(null);
const rangeInvestigateLoading = ref(false);
const rangeInvestigateError = ref<string | null>(null);

// ─── Freeform rectangle draw tool ──────────────────────────────────────────
//
// Click "Rectangle" to arm the tool, then click-drag anywhere on the chart
// to draw a highlight box. `x`/`width` are raw SVG pixel coordinates (fine
// as-is — horizontal panning only changes scrollLeft, not the coordinate
// system, so pixel x always lines up with the same candles). `priceHigh`/
// `priceLow` are stored as PRICES rather than pixel y/height, and converted
// back to pixels via priceToY() at render time — otherwise, dragging the
// canvas vertically (which shifts minPrice/maxPrice, not just the viewport)
// would leave the box sitting at its old pixel position instead of tracking
// the price level it was actually drawn at.
interface DrawnRectangle {
  id: number
  x: number
  width: number
  priceHigh: number
  priceLow: number
}

let rectIdCounter = 0
const rectModeActive = ref(false)
const rectDrawing = ref(false)
/** Live drag preview, kept in raw pixel space since it only exists for the duration of one drag gesture (price range can't shift mid-draw — rect mode and chart-pan are mutually exclusive). */
const rectPreview = ref<{ x: number; y: number; width: number; height: number } | null>(null)
const drawnRectangles = ref<DrawnRectangle[]>([])

function toggleRectMode() {
  rectModeActive.value = !rectModeActive.value
}

function removeRectangle(id: number) {
  drawnRectangles.value = drawnRectangles.value.filter(r => r.id !== id)
}

/** Converts a mouse event's client coordinates into position relative to the chart's <svg>. */
function getSvgPoint(event: MouseEvent): { x: number; y: number } | null {
  if (!chartContainer.value) return null
  const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
  if (!rect) return null
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function startRectDraw(event: MouseEvent) {
  if (!rectModeActive.value) return
  event.preventDefault()
  event.stopPropagation()
  const start = getSvgPoint(event)
  if (!start) return

  rectDrawing.value = true
  rectPreview.value = { x: start.x, y: start.y, width: 0, height: 0 }

  const handleMove = (moveEvent: MouseEvent) => {
    if (!rectDrawing.value) return
    const current = getSvgPoint(moveEvent)
    if (!current) return
    rectPreview.value = {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    }
  }

  const handleUp = () => {
    if (rectPreview.value && rectPreview.value.width > 2 && rectPreview.value.height > 2) {
      const { x, y, width, height } = rectPreview.value
      drawnRectangles.value.push({
        id: ++rectIdCounter,
        x,
        width,
        priceHigh: yToPrice(y),
        priceLow: yToPrice(y + height),
      })
    }
    rectDrawing.value = false
    rectPreview.value = null
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

function findRectangle(id: number): DrawnRectangle | undefined {
  return drawnRectangles.value.find(r => r.id === id)
}

/** Same idea as the other tools' price-shift helpers — converts a vertical mouse delta into a price delta at the current zoom/price-range. */
function rectPriceDelta(startClientY: number, moveClientY: number): number {
  const originalRange = maxPrice.value - minPrice.value
  return -((moveClientY - startClientY) / svgHeight) * originalRange
}

// ─── Horizontal price line tool ────────────────────────────────────────────
//
// Click "Line" to arm the tool, then double-click anywhere on the chart to
// drop a horizontal price line. The double-click's y-position only seeds a
// starting price — the DialogComponent modal that pops up lets the exact
// price (and an optional label) be confirmed or retyped before the line is
// actually created.
interface PriceLine {
  id: number
  price: number
  label: string
}

let priceLineIdCounter = 0
const lineModeActive = ref(false)
const priceLines = ref<PriceLine[]>([])

const showLineDialog = ref(false)
const lineDraftPrice = ref(0)
const lineDraftLabel = ref('')

function toggleLineMode() {
  lineModeActive.value = !lineModeActive.value
}

function removePriceLine(id: number) {
  priceLines.value = priceLines.value.filter(l => l.id !== id)
}

/** Double-click entry point for the Line tool — only acts while armed, otherwise falls through (no-op) so double-click elsewhere on the chart keeps its normal behavior. */
function handleChartDoubleClick(event: MouseEvent) {
  if (!lineModeActive.value) return
  event.preventDefault()
  event.stopPropagation()
  const point = getSvgPoint(event)
  if (!point) return
  lineDraftPrice.value = Number(yToPrice(point.y).toFixed(6))
  lineDraftLabel.value = ''
  showLineDialog.value = true
}

function confirmLineDraft() {
  if (isNaN(lineDraftPrice.value)) return
  priceLines.value.push({
    id: ++priceLineIdCounter,
    price: lineDraftPrice.value,
    label: lineDraftLabel.value.trim(),
  })
  showLineDialog.value = false
  lineModeActive.value = false // single-placement, same UX as the Anchored VWAP tool
}

function cancelLineDraft() {
  showLineDialog.value = false
  // Deliberately leaves lineModeActive as-is — a cancelled dialog shouldn't
  // force a re-click of the toolbar button to try placing the line again.
}

/** Drag a placed line's body up/down to reposition it — lines always span the full chart width, so only price (y) matters. */
function startPriceLineDrag(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const line = priceLines.value.find(l => l.id === id)
  if (!line) return

  const handleMove = (moveEvent: MouseEvent) => {
    const point = getSvgPoint(moveEvent)
    if (!point) return
    line.price = yToPrice(point.y)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

// ─── Rectangle / Line persistence (per symbol) ─────────────────────────────
//
// Rectangles are drawn/stored in raw SVG pixel space (rect.x/width), which
// only means anything relative to the CURRENT candleX() layout — reopening
// the chart (fresh props.candles, possibly a different candleWidth zoom)
// gives a different pixel grid entirely. So instead of persisting pixels,
// each rectangle's left/right edges are converted to an absolute time
// anchor (interpolated from the first loaded candle's openTime + the
// interval, same inverse math candleX() itself uses) before being written
// to localStorage, then converted back to pixels against whatever candle
// layout is active when the symbol is reopened. Price lines don't have this
// problem — they span the full chart width, so only price + label matter.
const DRAWING_STORAGE_PREFIX = 'candleVisualizer.drawings.'

function drawingStorageKey(symbol: string): string {
  return `${DRAWING_STORAGE_PREFIX}${symbol.toUpperCase()}`
}

interface StoredRectangle {
  leftTime: number
  rightTime: number
  priceHigh: number
  priceLow: number
}
interface StoredLine {
  price: number
  label: string
}
interface StoredDrawings {
  rectangles: StoredRectangle[]
  lines: StoredLine[]
}

/** Pixel-x → absolute time, using the same linear layout candleX() uses (fractional, not snapped to a candle). Null if no candles are loaded yet to anchor against. */
function xToTimeAnchor(x: number): number | null {
  const first = displayCandles.value[0]
  if (!first || first.openTime == null) return null
  const pixelPerCandle = candleWidth.value + candleGap
  const fractionalIndex = (x - 10 - candleWidth.value / 2) / pixelPerCandle
  return first.openTime + fractionalIndex * intervalToMs(props.interval)
}

/** Inverse of xToTimeAnchor — absolute time → pixel-x against the CURRENT candle layout. */
function timeAnchorToX(time: number): number | null {
  const first = displayCandles.value[0]
  if (!first || first.openTime == null) return null
  const pixelPerCandle = candleWidth.value + candleGap
  const fractionalIndex = (time - first.openTime) / intervalToMs(props.interval)
  return fractionalIndex * pixelPerCandle + candleWidth.value / 2 + 10
}

/** Guards the save watchers below so clearing/restoring drawings on a symbol switch doesn't itself get persisted as "this symbol has no drawings" before the real load has run. */
let drawingPersistenceReady = false
/** Small debounce so dragging a rectangle/line doesn't write to localStorage on every mousemove. */
let persistDrawingsTimer: ReturnType<typeof setTimeout> | null = null

function persistDrawings() {
  if (!drawingPersistenceReady) return
  if (persistDrawingsTimer !== null) clearTimeout(persistDrawingsTimer)
  persistDrawingsTimer = setTimeout(() => {
    try {
      const rectangles: StoredRectangle[] = []
      for (const r of drawnRectangles.value) {
        const leftTime = xToTimeAnchor(r.x)
        const rightTime = xToTimeAnchor(r.x + r.width)
        if (leftTime == null || rightTime == null) continue // no candles loaded to anchor against — skip rather than lose the time reference
        rectangles.push({ leftTime, rightTime, priceHigh: r.priceHigh, priceLow: r.priceLow })
      }
      const lines: StoredLine[] = priceLines.value.map(l => ({ price: l.price, label: l.label }))
      const payload: StoredDrawings = { rectangles, lines }
      localStorage.setItem(drawingStorageKey(props.symbol), JSON.stringify(payload))
    } catch {
      // localStorage unavailable/full — drawings just won't persist this session
    }
  }, 400)
}

watch(drawnRectangles, persistDrawings, { deep: true })
watch(priceLines, persistDrawings, { deep: true })

/** Loads whatever was saved for `symbol`, converting stored time anchors back to pixels against the candle layout that's active right now. Requires displayCandles to already have data — callers wait for that first. */
function restoreDrawingsForSymbol(symbol: string) {
  drawnRectangles.value = []
  priceLines.value = []
  try {
    const raw = localStorage.getItem(drawingStorageKey(symbol))
    if (raw) {
      const stored: StoredDrawings = JSON.parse(raw)
      for (const r of stored.rectangles ?? []) {
        const x = timeAnchorToX(r.leftTime)
        const rightX = timeAnchorToX(r.rightTime)
        if (x == null || rightX == null) continue
        drawnRectangles.value.push({
          id: ++rectIdCounter,
          x,
          width: Math.max(4, rightX - x),
          priceHigh: r.priceHigh,
          priceLow: r.priceLow,
        })
      }
      for (const l of stored.lines ?? []) {
        priceLines.value.push({ id: ++priceLineIdCounter, price: l.price, label: l.label })
      }
    }
  } catch {
    // corrupt/unavailable localStorage — just start with a clean chart for this symbol
  }
  drawingPersistenceReady = true
}

/** Runs restoreDrawingsForSymbol as soon as candles for the (possibly just-switched) symbol are actually loaded, since the time↔pixel conversion needs at least one candle to anchor against. */
function restoreDrawingsWhenReady(symbol: string) {
  drawingPersistenceReady = false // block saves while we clear/reload below
  if (displayCandles.value.length > 0) {
    restoreDrawingsForSymbol(symbol)
    return
  }
  const stop = watch(displayCandles, (candles) => {
    if (candles.length > 0) {
      stop()
      restoreDrawingsForSymbol(symbol)
    }
  })
}

// ─── Price range tool ───────────────────────────────────────────────────────
//
// Click "Price Range" to arm the tool, then click-drag vertically anywhere on
// the chart to measure the distance between two price levels. Same drag
// mechanic as the Rectangle tool, but instead of a plain highlight box it
// shows the absolute price difference and percent change, colored by
// direction (drag ends above where it started = up/green, below = down/red).
// Like DrawnRectangle, bounds are stored as PRICES and converted back to
// pixels via priceToY() at render time so the box tracks its price levels
// through vertical pan/zoom.
interface PriceRangeBox {
  id: number
  x: number
  width: number
  startPrice: number // price at mousedown — the "from" side
  endPrice: number   // price at mouseup — the "to" side
}

let priceRangeIdCounter = 0
const priceRangeModeActive = ref(false)
const priceRangeDrawing = ref(false)
/** Live drag preview — pixel space is fine here for the same reason as rectPreview: the gesture is too short for the price range to shift mid-draw. */
const priceRangePreview = ref<{ x: number; y: number; width: number; height: number; startPrice: number; endPrice: number } | null>(null)
const priceRanges = ref<PriceRangeBox[]>([])

function togglePriceRangeMode() {
  priceRangeModeActive.value = !priceRangeModeActive.value
}

function removePriceRange(id: number) {
  priceRanges.value = priceRanges.value.filter(r => r.id !== id)
}

function priceRangeIsUp(box: { startPrice: number; endPrice: number }): boolean {
  return box.endPrice >= box.startPrice
}
function priceRangeDiff(box: { startPrice: number; endPrice: number }): number {
  return box.endPrice - box.startPrice
}
function priceRangePercent(box: { startPrice: number; endPrice: number }): number {
  return box.startPrice === 0 ? 0 : (priceRangeDiff(box) / box.startPrice) * 100
}

function startPriceRangeDraw(event: MouseEvent) {
  if (!priceRangeModeActive.value) return
  event.preventDefault()
  event.stopPropagation()
  const start = getSvgPoint(event)
  if (!start) return

  priceRangeDrawing.value = true
  const startPrice = yToPrice(start.y)
  priceRangePreview.value = { x: start.x, y: start.y, width: 0, height: 0, startPrice, endPrice: startPrice }

  const handleMove = (moveEvent: MouseEvent) => {
    if (!priceRangeDrawing.value) return
    const current = getSvgPoint(moveEvent)
    if (!current) return
    priceRangePreview.value = {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
      startPrice,
      endPrice: yToPrice(current.y),
    }
  }

  const handleUp = () => {
    if (priceRangePreview.value && priceRangePreview.value.width > 2 && priceRangePreview.value.height > 2) {
      const { x, width, startPrice: sp, endPrice: ep } = priceRangePreview.value
      priceRanges.value.push({ id: ++priceRangeIdCounter, x, width, startPrice: sp, endPrice: ep })
    }
    priceRangeDrawing.value = false
    priceRangePreview.value = null
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

// ─── Rectangle post-placement adjustment (move + resize on all 4 edges) ───────
/** Drag the rectangle's body to move it freely — x (pixel) and price bounds shift together, offsets preserved. */
function startRectMoveDrag(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const rect = findRectangle(id)
  if (!rect) return
  const startClientX = event.clientX
  const startClientY = event.clientY
  const startX = rect.x
  const startPriceHigh = rect.priceHigh
  const startPriceLow = rect.priceLow

  const handleMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.clientX - startClientX
    const dPrice = rectPriceDelta(startClientY, moveEvent.clientY)
    rect.x = Math.max(0, startX + dx)
    rect.priceHigh = startPriceHigh + dPrice
    rect.priceLow = startPriceLow + dPrice
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Drag the left edge: adjusts x + width, right edge stays put. */
function startRectResizeLeft(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const rect = findRectangle(id)
  if (!rect) return
  const startClientX = event.clientX
  const startX = rect.x
  const rightEdge = rect.x + rect.width

  const handleMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.clientX - startClientX
    const newX = Math.min(rightEdge - 4, startX + dx)
    rect.x = newX
    rect.width = rightEdge - newX
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Drag the right edge: adjusts width only. */
function startRectResizeRight(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const rect = findRectangle(id)
  if (!rect) return
  const startClientX = event.clientX
  const startWidth = rect.width

  const handleMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.clientX - startClientX
    rect.width = Math.max(4, startWidth + dx)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Drag the top edge: adjusts priceHigh only. */
function startRectResizeTop(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const rect = findRectangle(id)
  if (!rect) return
  const startClientY = event.clientY
  const startPriceHigh = rect.priceHigh

  const handleMove = (moveEvent: MouseEvent) => {
    const newPriceHigh = startPriceHigh + rectPriceDelta(startClientY, moveEvent.clientY)
    rect.priceHigh = Math.max(newPriceHigh, rect.priceLow + 1e-9)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Drag the bottom edge: adjusts priceLow only. */
function startRectResizeBottom(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const rect = findRectangle(id)
  if (!rect) return
  const startClientY = event.clientY
  const startPriceLow = rect.priceLow

  const handleMove = (moveEvent: MouseEvent) => {
    const newPriceLow = startPriceLow + rectPriceDelta(startClientY, moveEvent.clientY)
    rect.priceLow = Math.min(newPriceLow, rect.priceHigh - 1e-9)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/**
 * Chart container's single mousedown entry point. Routes to the rectangle
 * or price-range tool when either is armed, otherwise falls through to the
 * existing chart-pan behavior (which itself already yields to the Volume
 * Profile tool). The Line tool doesn't need an entry here — it places on
 * double-click, handled separately by handleChartDoubleClick.
 */
function handleChartMouseDown(event: MouseEvent) {
  if (rectModeActive.value) {
    startRectDraw(event)
    return
  }
  if (priceRangeModeActive.value) {
    startPriceRangeDraw(event)
    return
  }
  startChartDrag(event)
}

// ─── Anchored VWAP tool ─────────────────────────────────────────────────────
//
// Click "Anchored VWAP" to arm the tool, then click a single candle to drop
// an anchor there. From the anchor forward, we run a cumulative
// volume-weighted average of typical price ((H+L+C)/3), same as Binance/
// TradingView's Anchored VWAP — plus upper/lower bands built from the
// cumulative (volume-weighted) standard deviation of typical price around
// that running mean, widened by AVWAP_BAND_MULTIPLIER. The tool disarms
// itself after one placement (it's a single-click anchor, not a drag range),
// and multiple anchors can be stacked — each gets its own color and remove (✕).
//
// `endIndex: null` means "open-ended" — the series keeps extending to
// whatever the latest displayed candle is, live-updating as new candles
// arrive (the original behavior). Dragging the small end-handle pins it to
// an explicit candle instead; dragging that handle back out to the last
// candle reopens it to `null` so it resumes auto-extending.
interface AnchoredVwap {
  id: number
  anchorIndex: number
  endIndex: number | null
}

interface AnchoredVwapPoint {
  index: number
  mid: number
  upper: number
  lower: number
}

// Reuses ANCHORED_VWAP_BAND_MULTIPLIER from utility/anchoredVwap.ts (the standalone
// getAnchorVwap() function) so the chart's line/bands and any code calling
// getAnchorVwap() directly can never drift out of sync on this value.
const AVWAP_BAND_MULTIPLIER = candleAnalyzer.getAnchorVwapBandMultiplier()
const AVWAP_COLORS = ['#facc15', '#38bdf8', '#f472b6', '#a78bfa', '#4ade80', '#fb923c']

let avwapIdCounter = 0
const avwapModeActive = ref(false)
const anchoredVwaps = ref<AnchoredVwap[]>([])
/** id of the anchored VWAP whose end-handle is currently being dragged, if any — used to dim/highlight it while adjusting. */
const avwapEndDraggingId = ref<number | null>(null)

/** "Fill PZ AVWAP" dropdown (past 6 zones / all zones) open/closed state, plus the wrapper ref used to detect outside clicks. */
const pzAvwapDropdownOpen = ref(false)
const pzAvwapDropdownRef = ref<HTMLElement | null>(null)

/** Toggles the shaded band + upper/lower lines on every placed AVWAP; the mid line always stays visible. */
const showAvwapBands = ref(true)

function toggleAvwapMode() {
  avwapModeActive.value = !avwapModeActive.value
}

function removeAnchoredVwap(id: number) {
  anchoredVwaps.value = anchoredVwaps.value.filter(a => a.id !== id)
}

/**
 * Cumulative VWAP + volume-weighted stdev bands from `anchorIndex` through
 * `endIndex` (inclusive). Pass `null` for endIndex to run through the last
 * currently-displayed candle (open-ended / live-extending). Bails out
 * row-by-row on missing OHLC/volume rather than skipping the whole candle,
 * since a gap just means that candle contributes nothing to the running sums.
 */
function computeAnchoredVwapPoints(anchorIndex: number, endIndex: number | null): AnchoredVwapPoint[] {
  const candles = displayCandles.value
  const points: AnchoredVwapPoint[] = []
  const lastIndex = Math.min(endIndex ?? candles.length - 1, candles.length - 1)

  let cumPV = 0   // Σ (typicalPrice * volume)
  let cumPV2 = 0  // Σ (typicalPrice² * volume) — for weighted variance
  let cumVol = 0  // Σ volume

  for (let i = anchorIndex; i <= lastIndex; i++) {
    const c = candles[i]
    if (c.high == null || c.low == null || c.close == null) continue

    const typical = (c.high + c.low + c.close) / 3
    const vol = c.volume ?? 0

    cumPV += typical * vol
    cumPV2 += typical * typical * vol
    cumVol += vol

    if (cumVol <= 0) continue

    const mean = cumPV / cumVol
    const variance = Math.max(cumPV2 / cumVol - mean * mean, 0)
    const stdev = Math.sqrt(variance)

    points.push({
      index: i,
      mid: mean,
      upper: mean + stdev * AVWAP_BAND_MULTIPLIER,
      lower: mean - stdev * AVWAP_BAND_MULTIPLIER,
    })
  }

  return points
}

const anchoredVwapSeries = computed(() => {
  return anchoredVwaps.value.map((a, i) => {
    const points = computeAnchoredVwapPoints(a.anchorIndex, a.endIndex)
    const anchorCandle = displayCandles.value[a.anchorIndex]
    const lastPoint = points[points.length - 1] ?? null
    // Where the end-handle renders: the pinned endIndex if set, otherwise the last displayed candle (open-ended).
    const effectiveEndIndex = a.endIndex ?? displayCandles.value.length - 1
    return {
      id: a.id,
      anchorIndex: a.anchorIndex,
      endIndex: a.endIndex,
      effectiveEndIndex,
      isOpenEnded: a.endIndex === null,
      anchorPrice: points[0]?.mid ?? anchorCandle?.close ?? 0,
      endPrice: lastPoint?.mid ?? anchorCandle?.close ?? 0,
      color: AVWAP_COLORS[i % AVWAP_COLORS.length],
      points,
    }
  })
})

/** Builds an SVG `points` string for one of the three lines (mid/upper/lower) of an anchored VWAP. */
function avwapLinePoints(points: AnchoredVwapPoint[], key: 'mid' | 'upper' | 'lower'): string {
  return points.map(p => `${candleX(p.index)},${priceToY(p[key])}`).join(' ')
}

/** Builds the closed polygon (upper edge forward, lower edge back) used for the shaded band fill. */
function avwapBandPolygon(points: AnchoredVwapPoint[]): string {
  if (points.length === 0) return ''
  const top = points.map(p => `${candleX(p.index)},${priceToY(p.upper)}`)
  const bottom = [...points].reverse().map(p => `${candleX(p.index)},${priceToY(p.lower)}`)
  return [...top, ...bottom].join(' ')
}

/** Drops an anchor at `index` when the tool is armed, then disarms itself (single-click placement, not a drag). Starts open-ended — drag the end-handle afterward to pin it. */
function handleCandleMouseDownForAvwap(index: number, event: MouseEvent) {
  if (!avwapModeActive.value) return
  event.preventDefault()
  event.stopPropagation()

  anchoredVwaps.value.push({ id: ++avwapIdCounter, anchorIndex: index, endIndex: null })
  avwapModeActive.value = false
}

/**
 * Drag handle at the end of an anchored VWAP series — lets you pin the
 * series to stop at an earlier candle instead of always running to the
 * latest one. Dragging it all the way back out to the last displayed
 * candle reopens the series to `endIndex: null` (auto-extending again).
 *
 * Rebuilds `anchoredVwaps.value` with a fresh array on every move (rather
 * than mutating the found item's `endIndex` in place) so the reassignment
 * unambiguously triggers the ref and `anchoredVwapSeries` recomputes live
 * on every drag tick, not just once something else happens to re-render.
 */
function startAvwapEndDrag(avwapId: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()

  const target = anchoredVwaps.value.find(a => a.id === avwapId)
  if (!target) return
  const anchorIndex = target.anchorIndex

  avwapEndDraggingId.value = avwapId

  const applyEndIndex = (endIndex: number | null) => {
    anchoredVwaps.value = anchoredVwaps.value.map(a =>
      a.id === avwapId ? { ...a, endIndex } : a
    )
  }

  const handleMove = (moveEvent: MouseEvent) => {
    if (!chartContainer.value) return
    const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
    if (!rect) return
    const x = moveEvent.clientX - rect.left
    const rawIndex = Math.round((x - 10 - candleWidth.value / 2) / (candleWidth.value + candleGap))
    const lastIndex = displayCandles.value.length - 1
    const clamped = Math.max(anchorIndex + 1, Math.min(lastIndex, rawIndex))
    // Dragged all the way to the last candle → reopen to auto-extending instead of pinning to "currently last".
    applyEndIndex(clamped >= lastIndex ? null : clamped)
  }

  const handleUp = () => {
    avwapEndDraggingId.value = null
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/**
 * "Fill PZ AVWAP" — auto-anchors one Anchored VWAP at the start candle of
 * every Price Zone, instead of hand-clicking each zone's opening candle.
 * Walks displayCandles the same way fillPriceZonesWithVolumeProfile does to
 * find each zone's startIndex (grouped by candle.priceZone), then replaces
 * whatever AVWAPs are currently placed with a fresh one per zone.
 *
 * `scope` controls how many zones get filled:
 *   - 'recent' → only the 6 most recent zones (keeps the chart from getting
 *     buried in overlapping open-ended lines when there are many zones)
 *   - 'all'    → every zone currently on the chart
 *
 * Each placed AVWAP is left open-ended (endIndex: null) — same as a normal
 * single-click placement — so every zone's VWAP keeps extending forward to
 * the latest candle rather than stopping at its own zone's end. Purely
 * synchronous (computeAnchoredVwapPoints has no network dependency, unlike
 * the VP fill's OI lookups), so all zones appear at once.
 */
function fillPriceZonesWithAvwap(scope: 'recent' | 'all') {
  const anchorIndices: number[] = []
  let currentZone: CandleEntry['priceZone'] | null = null

  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.priceZone && (!currentZone || JSON.stringify(currentZone) !== JSON.stringify(candle.priceZone))) {
      currentZone = candle.priceZone
      anchorIndices.push(i)
    }
  }

  const selected = scope === 'recent' ? anchorIndices.slice(-6) : anchorIndices

  anchoredVwaps.value = selected.map(anchorIndex => ({
    id: ++avwapIdCounter,
    anchorIndex,
    endIndex: null,
  }))
}


function handleCandleMouseDown(index: number, event: MouseEvent) {
  if (rangeInvestigateAddingResultRangeId.value !== null) {
    handleCandleMouseDownForResultRange(rangeInvestigateAddingResultRangeId.value, index, event)
    return
  }
  if (avwapModeActive.value) {
    handleCandleMouseDownForAvwap(index, event)
    return
  }
  if (rangeDownloadModeActive.value) {
    handleCandleMouseDownForRangeDownload(index, event)
    return
  }
  if (rangeInvestigateModeActive.value) {
    handleCandleMouseDownForRangeInvestigate(index, event)
    return
  }
  if (summarizeModeActive.value) {
    handleCandleMouseDownForSummarize(index, event)
    return
  }
  handleCandleMouseDownForVp(index, event)
}

// ─── Backtest / playback controls ──────────────────────────────────────────
//
// "Start Backtest" freezes the chart at candle index 0 and disconnects all
// live streams (kline/depth/trade) so nothing updates behind the scenes.
// Prev/Next step through props.candles one at a time; displayCandles below
// is sliced down to [0, backtestIndex] while backtestActive is true, so
// future candles are fully hidden rather than just dimmed.
const backtestActive = ref(false)
const backtestIndex = ref(0)

function startBacktest() {
  backtestActive.value = true
  backtestIndex.value = 0
  backtestPositions.value = []
  backtestPlaceError.value = null
  clearPreview()
  disconnectWebSocket()
  disconnectDepthWebSocket()
}

function stopBacktest() {
  backtestActive.value = false
  connectWebSocket()
  connectDepthWebSocket()
}

function backtestPrev() {
  if (backtestIndex.value > 0) backtestIndex.value -= 1
}

function backtestNext() {
  if (backtestIndex.value < props.candles.length - 1) backtestIndex.value += 1
}

// ─── Backtest long/short position placement ───────────────────────────────
//
// While backtesting, "Long"/"Short" places a position at the candle
// currently on screen (backtestIndex), using the same TP/SL ROI% calc as
// the live Preview Buy/Sell flow. As you step forward with Next, each
// placed position is re-evaluated against the candles you've revealed so
// far to see whether TP or SL was touched first — reusing the same
// tp-sl-rect styling/status classes as the rest of the chart.
interface BacktestPosition {
  id: number
  side: 'LONG' | 'SHORT'
  entryIndex: number
  entryPrice: number
  tpPrice: number
  slPrice: number
}

let backtestPositionIdCounter = 0
const backtestPositions = ref<BacktestPosition[]>([])
const backtestPlacingSide = ref<'LONG' | 'SHORT' | null>(null)
const backtestPlaceError = ref<string | null>(null)

async function placeBacktestPosition(side: 'LONG' | 'SHORT') {
  if (!backtestActive.value) return
  const entryCandle = props.candles[backtestIndex.value]
  if (!entryCandle || entryCandle.close == null) {
    backtestPlaceError.value = 'No candle to enter against yet.'
    return
  }

  backtestPlaceError.value = null
  backtestPlacingSide.value = side

  try {
    const apiSide = side === 'LONG' ? 'BUY' : 'SELL'
    const tpSl = await OrderMakerUtility.calculateTpSl(
      previewMargin.value,
      props.symbol,
      apiSide,
      entryCandle.close.toString(),
      targetTpRoi.value,
      targetSlRoi.value
    )

    backtestPositions.value.push({
      id: ++backtestPositionIdCounter,
      side,
      entryIndex: backtestIndex.value,
      entryPrice: entryCandle.close,
      tpPrice: tpSl.tp_price,
      slPrice: tpSl.sl_price,
    })
  } catch (error) {
    console.error('Failed to place backtest position:', error)
    backtestPlaceError.value = 'Failed to place position. Please try again.'
  } finally {
    backtestPlacingSide.value = null
  }
}

function removeBacktestPosition(id: number) {
  backtestPositions.value = backtestPositions.value.filter(p => p.id !== id)
}

function findBacktestPosition(id: number): BacktestPosition | undefined {
  return backtestPositions.value.find(p => p.id === id)
}

/**
 * Converts a mouse event's clientX into a candle-index position. Returns a
 * continuous (non-rounded) value for smooth dragging, and is only clamped
 * at the low end (can't go left of the first candle) — there's no upper
 * clamp, so this happily returns indexes past the last candle, i.e. out
 * into blank/no-candle-yet space to the right of the chart.
 */
function clientXToCandleIndex(clientX: number): number | null {
  if (!chartContainer.value) return null
  const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
  if (!rect) return null
  const x = clientX - rect.left
  const rawIndex = (x - 10 - candleWidth.value / 2) / (candleWidth.value + candleGap) - multiTfPrependOffsetSlots.value
  return Math.max(0, rawIndex)
}

// ─── Backtest position free-drag (fully freeform, like the Rectangle tool) ────
//
// Four independent handles per position:
//  - entry line  → vertical only, moves entryPrice
//  - tp line     → vertical only, moves tpPrice
//  - sl line     → vertical only, moves slPrice
//  - move handle → horizontal (free — can be dragged anywhere, including
//                  blank space with no candle data yet) + vertical (free),
//                  drags the WHOLE position — entry candle and all three
//                  prices shift together, offsets preserved.
function backtestPriceShift(startClientY: number, moveClientY: number): number {
  const originalRange = maxPrice.value - minPrice.value
  return -((moveClientY - startClientY) / svgHeight) * originalRange
}

function startBacktestEntryDrag(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const pos = findBacktestPosition(id)
  if (!pos) return
  const startY = event.clientY
  const startEntry = pos.entryPrice

  const handleMove = (moveEvent: MouseEvent) => {
    pos.entryPrice = startEntry + backtestPriceShift(startY, moveEvent.clientY)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

function startBacktestTpDrag(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const pos = findBacktestPosition(id)
  if (!pos) return
  const startY = event.clientY
  const startTp = pos.tpPrice

  const handleMove = (moveEvent: MouseEvent) => {
    pos.tpPrice = startTp + backtestPriceShift(startY, moveEvent.clientY)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

function startBacktestSlDrag(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const pos = findBacktestPosition(id)
  if (!pos) return
  const startY = event.clientY
  const startSl = pos.slPrice

  const handleMove = (moveEvent: MouseEvent) => {
    pos.slPrice = startSl + backtestPriceShift(startY, moveEvent.clientY)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

function startBacktestMoveDrag(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const pos = findBacktestPosition(id)
  if (!pos) return
  const startY = event.clientY
  const startEntryPrice = pos.entryPrice
  const startTpPrice = pos.tpPrice
  const startSlPrice = pos.slPrice

  const handleMove = (moveEvent: MouseEvent) => {
    const newIndex = clientXToCandleIndex(moveEvent.clientX)
    if (newIndex !== null) {
      pos.entryIndex = newIndex
    }
    const priceShift = backtestPriceShift(startY, moveEvent.clientY)
    pos.entryPrice = startEntryPrice + priceShift
    pos.tpPrice = startTpPrice + priceShift
    pos.slPrice = startSlPrice + priceShift
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/**
 * Walks forward from a backtest position's entry through the candles
 * revealed so far (up to backtestIndex) to find whether TP or SL was hit
 * first. Status strings match the existing `status-*` CSS classes
 * (open / win_long / win_short / loss_long / loss_short).
 *
 * `pos.entryIndex` can now be a non-integer (mid-drag) or sit beyond
 * `backtestIndex` entirely (dragged out into blank/no-candle-yet space) —
 * `entryIdx` rounds it for the actual candle lookup, and `endIndex` is
 * clamped to never fall short of it, so a position parked in blank space
 * renders as a zero-width marker instead of a negative-width box.
 */
function evaluateBacktestPosition(pos: BacktestPosition) {
  const isLong = pos.side === 'LONG'
  const entryIdx = Math.round(pos.entryIndex)
  let endIndex = Math.max(entryIdx, Math.min(backtestIndex.value, props.candles.length - 1))
  let status = 'open'

  for (let j = entryIdx + 1; j <= backtestIndex.value; j++) {
    const c = props.candles[j]
    if (!c || c.high == null || c.low == null) continue
    const hitTp = isLong ? c.high >= pos.tpPrice : c.low <= pos.tpPrice
    const hitSl = isLong ? c.low <= pos.slPrice : c.high >= pos.slPrice
    if (!hitTp && !hitSl) continue

    endIndex = j
    if (hitTp && hitSl) {
      // Both boundaries touched within the same candle — OHLC alone can't
      // tell us which came first, so approximate using distance from open.
      const distToTp = Math.abs((c.open ?? pos.entryPrice) - pos.tpPrice)
      const distToSl = Math.abs((c.open ?? pos.entryPrice) - pos.slPrice)
      status = distToTp <= distToSl
        ? (isLong ? 'win_long' : 'win_short')
        : (isLong ? 'loss_long' : 'loss_short')
    } else if (hitTp) {
      status = isLong ? 'win_long' : 'win_short'
    } else {
      status = isLong ? 'loss_long' : 'loss_short'
    }
    break
  }

  return { ...pos, endIndex, status }
}

const renderedBacktestPositions = computed(() => {
  if (!backtestActive.value) return []
  return backtestPositions.value.map(evaluateBacktestPosition)
})

const backtestPositionBoxes = computed(() => {
  const boxes: any[] = []
  for (const pos of renderedBacktestPositions.value) {
    const isLong = pos.side === 'LONG'
    const boxLeftX = candleX(pos.entryIndex) - candleWidth.value / 2
    const boxRightX = candleX(pos.endIndex) + candleWidth.value / 2
    const boxWidth = boxRightX - boxLeftX

    const tpUpper = isLong ? pos.tpPrice : pos.entryPrice
    const tpLower = isLong ? pos.entryPrice : pos.tpPrice
    boxes.push({
      id: `bt-tp-${pos.id}`,
      x: boxLeftX,
      y: priceToY(tpUpper),
      width: boxWidth,
      height: priceToY(tpLower) - priceToY(tpUpper),
      type: 'tp',
      status: pos.status,
    })

    const slUpper = isLong ? pos.entryPrice : pos.slPrice
    const slLower = isLong ? pos.slPrice : pos.entryPrice
    boxes.push({
      id: `bt-sl-${pos.id}`,
      x: boxLeftX,
      y: priceToY(slUpper),
      width: boxWidth,
      height: priceToY(slLower) - priceToY(slUpper),
      type: 'sl',
      status: pos.status,
    })
  }
  return boxes
})

// ─── Zone-full marker: broken orange vertical line ─────────────────────────
// Drawn across the full chart height whenever a candle's
// candleData.zoneInhabitantCount reaches 24 (i.e. its zone is fully seated).
const zoneFullVerticalLines = computed(() => {
  const xs: number[] = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    if (displayCandles.value[i].candleData?.zoneInhabitantCount === 24) {
      xs.push(candleX(i))
    }
  }
  return xs
})

// ─── Volume Profile Fixed Range tool ───────────────────────────────────────
//
// Click "Volume Profile" to arm the tool, then mousedown on a candle and
// drag to another candle to draw a fixed-range volume profile over that
// span. The profile buckets price into rows and, for every candle in the
// range, spreads that candle's volume across the rows its high↔low wick
// touches (proportional to overlap). Volume from bullish candles is tagged
// "buy", from bearish candles "sell" — an approximation since OHLCV alone
// has no real buy/sell tape, but it's the same method most charting
// platforms use for this kind of profile. The row with the largest total
// volume is the POC (point of control), drawn as the profile's mid line.
interface VolumeProfileRange {
  id: number
  startIndex: number
  endIndex: number
}

const VP_NUM_BUCKETS = 24
const VP_MAX_BAR_WIDTH = 140

let vpIdCounter = 0
const vpModeActive = ref(false)
const vpDragging = ref(false)
const vpStartIndex = ref<number | null>(null)
const vpEndIndex = ref<number | null>(null)
const volumeProfiles = ref<VolumeProfileRange[]>([])

// ─── OI rate per FRVP profile ────────────────────────────────────────────────
// Keyed by profile id since the OI fetch is async and range-specific (unlike
// computeVolumeProfile, which is synchronous and derived purely from candles
// already in memory). Reset/refetched whenever a profile's range changes.
interface VpOiState {
  status: 'loading' | 'ready' | 'error' | 'no-data'
  data?: OpenInterestRangeRate
  error?: string
}
const vpOiRates = ref<Record<number, VpOiState>>({})

// ─── Bias/confidence analysis per FRVP profile ──────────────────────────────
// Runs automatically the moment a profile's OI rate finishes loading. Each
// run re-analyzes every currently placed profile from oldest to this one
// (inclusive) via analyzeFrvps, so the bias/confidence shown on a given VP
// reflects the full confluence picture built up to that point in time, not
// just that single zone in isolation.
interface VpAnalysisState {
  status: 'analyzing' | 'ready' | 'error' | 'insufficient'
  bias?: string
  confidencePct?: number
}
const vpAnalysis = ref<Record<number, VpAnalysisState>>({})

async function runVpAnalysisForProfile(id: number) {
  const target = findVolumeProfile(id)
  if (!target) return

  // Oldest → this VP (inclusive). Same "oldest to current" ordering as the
  // OI fetch queue in the fill functions, just scoped up to this profile.
  const upToHere = volumeProfiles.value
    .filter(p => p.startIndex <= target.startIndex)
    .sort((a, b) => a.startIndex - b.startIndex)

  if (upToHere.length === 0) {
    vpAnalysis.value[id] = { status: 'insufficient' }
    return
  }

  vpAnalysis.value[id] = { status: 'analyzing' }
  try {
    const zoneInputs: FrvpZoneInput[] = []
    for (const meta of upToHere) {
      const payload = buildFrvpExportPayload(meta.id)
      if (!payload) continue
      zoneInputs.push({
        id: meta.id,
        startIndex: payload.range.startIndex,
        endIndex: payload.range.endIndex,
        candles: payload.candles,
        fixedRangeVolumeProfile: payload.fixedRangeVolumeProfile,
        openInterest: payload.openInterest as FrvpZoneInput['openInterest'],
      })
    }
    if (zoneInputs.length === 0) {
      vpAnalysis.value[id] = { status: 'insufficient' }
      return
    }

    const result = analyzeFrvps(zoneInputs, {
      symbol: props.symbol.toUpperCase(),
      interval: props.interval,
    })!
    vpAnalysis.value[id] = { status: 'ready', bias: result.bias, confidencePct: result.confidencePct }
  } catch (err) {
    vpAnalysis.value[id] = { status: 'error' }
  }
}

async function loadOiRateForProfile(id: number, startIndex: number, endIndex: number) {
  const startCandle = displayCandles.value[startIndex]
  const endCandle = displayCandles.value[endIndex]
  if (!startCandle?.openTime || !endCandle?.openTime) return

  vpOiRates.value[id] = { status: 'loading' }
  try {
    const intervalMs = intervalToMs(props.interval)
    const startTime = startCandle.openTime
    const endTime = endCandle.openTime + intervalMs
    const data = await getOpenInterestRateForRange(props.symbol, startTime, endTime)
    vpOiRates.value[id] = data ? { status: 'ready', data } : { status: 'no-data' }
  } catch (err) {
    vpOiRates.value[id] = { status: 'error', error: err instanceof Error ? err.message : 'failed' }
  }

  // OI rate is in (ready or otherwise) — run/refresh this VP's bias analysis now.
  if (vpOiRates.value[id]?.status === 'ready') {
    await runVpAnalysisForProfile(id)
  }
}

function toggleVpMode() {
  vpModeActive.value = !vpModeActive.value
}

/** Wraps openCandleModal so the modal doesn't pop open mid-drag/mid-click while the VP or Anchored VWAP tools are armed. */
function handleCandleClick(index: number) {
  if (vpModeActive.value || avwapModeActive.value) return
  openCandleModal(index)
}

function removeVolumeProfile(id: number) {
  volumeProfiles.value = volumeProfiles.value.filter(p => p.id !== id)
  delete vpOiRates.value[id]
  delete vpAnalysis.value[id]
}

function findVolumeProfile(id: number): VolumeProfileRange | undefined {
  return volumeProfiles.value.find(p => p.id === id)
}

/**
 * Nudge the right edge (endIndex) of a placed profile one candle at a time.
 * dir = +1 moves the end point forward to the next candle, -1 moves it back
 * to the previous candle. Clamped so it can never cross startIndex or run
 * past the last available candle.
 */
function nudgeVpEndIndex(id: number, dir: 1 | -1, event?: MouseEvent) {
  event?.preventDefault()
  event?.stopPropagation()
  const profile = findVolumeProfile(id)
  if (!profile) return

  const next = Math.max(
    profile.startIndex + 1,
    Math.min(displayCandles.value.length - 1, profile.endIndex + dir)
  )
  if (next === profile.endIndex) return

  profile.endIndex = next
  loadOiRateForProfile(id, profile.startIndex, profile.endIndex)
}

/**
 * Drag the left edge of a placed profile to adjust startIndex — extends or
 * shrinks the period from the left after placement. Snapped to whole
 * candles (unlike the backtest-position move handle, a volume profile has
 * to stay within actual candle data, since it aggregates real OHLCV).
 */
function startVpResizeLeft(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const profile = findVolumeProfile(id)
  if (!profile) return

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.round(raw)
    profile.startIndex = Math.max(0, Math.min(snapped, profile.endIndex - 1))
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
    loadOiRateForProfile(id, profile.startIndex, profile.endIndex)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Drag the right edge of a placed profile to adjust endIndex — extends or shrinks the period from the right after placement. */
function startVpResizeRight(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const profile = findVolumeProfile(id)
  if (!profile) return

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.max(0, Math.min(displayCandles.value.length - 1, Math.round(raw)))
    profile.endIndex = Math.max(profile.startIndex + 1, snapped)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
    loadOiRateForProfile(id, profile.startIndex, profile.endIndex)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

function handleCandleMouseDownForVp(index: number, event: MouseEvent) {
  if (!vpModeActive.value) return
  // Stop this from bubbling into startChartDrag (panning) on the container.
  event.preventDefault()
  event.stopPropagation()

  vpDragging.value = true
  vpStartIndex.value = index
  vpEndIndex.value = index

  const handleMove = (moveEvent: MouseEvent) => {
    if (!vpDragging.value || !chartContainer.value) return
    const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
    if (!rect) return
    const x = moveEvent.clientX - rect.left
    const rawIndex = Math.round((x - 10 - candleWidth.value / 2) / (candleWidth.value + candleGap))
    vpEndIndex.value = Math.max(0, Math.min(displayCandles.value.length - 1, rawIndex))
  }

  const handleUp = () => {
    if (vpStartIndex.value !== null && vpEndIndex.value !== null) {
      const s = Math.min(vpStartIndex.value, vpEndIndex.value)
      const e = Math.max(vpStartIndex.value, vpEndIndex.value)
      if (e > s) {
        const id = ++vpIdCounter
        volumeProfiles.value.push({ id, startIndex: s, endIndex: e })
        loadOiRateForProfile(id, s, e)
      }
    }
    vpDragging.value = false
    vpStartIndex.value = null
    vpEndIndex.value = null
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

// ─── Range Download tool ────────────────────────────────────────────────────
//
// Click "Range Download" to arm the tool, then mousedown on a candle and
// drag to another candle to select a candle range — same click-drag
// mechanic as the Volume Profile tool above, but instead of building a
// histogram it just draws a plain selection box with a "download range"
// button on top. Clicking it exports everything already on screen for that
// span (OHLCV + EMA200, AVWAP points, any overlapping FRVP, and the
// per-candle OI / Long-Short-Ratio samples) as a single JSON file — no
// separate network fetch, since all of that data is already loaded into the
// chart's own reactive state (oiPerCandle, lsRatioPerCandle, etc.).
interface RangeDownloadBox {
  id: number
  startIndex: number
  endIndex: number
}

const rangeDownloadModeActive = ref(false)
const rangeDownloadBoxes = ref<RangeDownloadBox[]>([])
let rangeDownloadIdCounter = 0

const rangeDownloadDragging = ref(false)
const rangeDownloadStartIndex = ref<number | null>(null)
const rangeDownloadEndIndex = ref<number | null>(null)

function toggleRangeDownloadMode() {
  rangeDownloadModeActive.value = !rangeDownloadModeActive.value
}

function removeRangeDownloadBox(id: number) {
  rangeDownloadBoxes.value = rangeDownloadBoxes.value.filter(b => b.id !== id)
}

function findRangeDownloadBox(id: number): RangeDownloadBox | undefined {
  return rangeDownloadBoxes.value.find(b => b.id === id)
}

/**
 * Drag the left edge of a placed range box to adjust startIndex — extends
 * or shrinks the selection from the left after placement. Snapped to whole
 * candles, same approach as the VP tool's edge handles (nothing to
 * re-fetch here since the export is built on demand from state already in
 * memory).
 */
function startRangeDownloadResizeLeft(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const box = findRangeDownloadBox(id)
  if (!box) return

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.round(raw)
    box.startIndex = Math.max(0, Math.min(snapped, box.endIndex - 1))
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Drag the right edge of a placed range box to adjust endIndex — extends or shrinks the selection from the right after placement. */
function startRangeDownloadResizeRight(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const box = findRangeDownloadBox(id)
  if (!box) return

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.max(0, Math.min(displayCandles.value.length - 1, Math.round(raw)))
    box.endIndex = Math.max(box.startIndex + 1, snapped)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/**
 * Pixel geometry for a range box — same "high↔low of every candle in the
 * span" framing as computeVolumeProfile's range bounds, just without the
 * histogram, since this box only exists to mark a selection for export.
 */
function computeRangeDownloadBoxGeometry(startIndex: number, endIndex: number) {
  const candles = displayCandles.value.slice(startIndex, endIndex + 1)
  if (candles.length === 0) return null

  let rangeLow = Infinity
  let rangeHigh = -Infinity
  for (const c of candles) {
    if (c.low == null || c.high == null) continue
    if (c.low < rangeLow) rangeLow = c.low
    if (c.high > rangeHigh) rangeHigh = c.high
  }
  if (!isFinite(rangeLow) || !isFinite(rangeHigh) || rangeHigh <= rangeLow) return null

  return {
    leftX: candleX(startIndex) - candleWidth.value / 2,
    rightX: candleX(endIndex) + candleWidth.value / 2,
    rangeTop: priceToY(rangeHigh),
    rangeBottom: priceToY(rangeLow),
  }
}

/** All finalized (click-drag-completed) range boxes, recomputed reactively as price scale/zoom changes. */
const renderedRangeDownloadBoxes = computed(() => {
  return rangeDownloadBoxes.value
    .map(b => {
      const geo = computeRangeDownloadBoxGeometry(b.startIndex, b.endIndex)
      return geo ? { ...geo, id: b.id, startIndex: b.startIndex, endIndex: b.endIndex } : null
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
})

/** Live preview of the box while the user is still dragging. */
const draggingRangeDownloadPreview = computed(() => {
  if (!rangeDownloadDragging.value || rangeDownloadStartIndex.value === null || rangeDownloadEndIndex.value === null) return null
  const s = Math.min(rangeDownloadStartIndex.value, rangeDownloadEndIndex.value)
  const e = Math.max(rangeDownloadStartIndex.value, rangeDownloadEndIndex.value)
  if (e <= s) return null
  return computeRangeDownloadBoxGeometry(s, e)
})

function handleCandleMouseDownForRangeDownload(index: number, event: MouseEvent) {
  if (!rangeDownloadModeActive.value) return
  // Stop this from bubbling into startChartDrag (panning) on the container.
  event.preventDefault()
  event.stopPropagation()

  rangeDownloadDragging.value = true
  rangeDownloadStartIndex.value = index
  rangeDownloadEndIndex.value = index

  const handleMove = (moveEvent: MouseEvent) => {
    if (!rangeDownloadDragging.value || !chartContainer.value) return
    const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
    if (!rect) return
    const x = moveEvent.clientX - rect.left
    const rawIndex = Math.round((x - 10 - candleWidth.value / 2) / (candleWidth.value + candleGap))
    rangeDownloadEndIndex.value = Math.max(0, Math.min(displayCandles.value.length - 1, rawIndex))
  }

  const handleUp = () => {
    if (rangeDownloadStartIndex.value !== null && rangeDownloadEndIndex.value !== null) {
      const s = Math.min(rangeDownloadStartIndex.value, rangeDownloadEndIndex.value)
      const e = Math.max(rangeDownloadStartIndex.value, rangeDownloadEndIndex.value)
      if (e > s) {
        rangeDownloadBoxes.value.push({ id: ++rangeDownloadIdCounter, startIndex: s, endIndex: e })
      }
    }
    rangeDownloadDragging.value = false
    rangeDownloadStartIndex.value = null
    rangeDownloadEndIndex.value = null
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

// ─── Range Investigate tool ─────────────────────────────────────────────────
//
// Same click-drag box mechanic as Range Download, kept as its own
// independent tool/state so the two selections don't collide. Instead of
// exporting the range, the box's "🔍 Investigate" button runs it through
// rangeInvestigate.ts to explain WHY that range moved the way it did and
// predict continuation/pullback/reversal for the next price zone.
interface RangeInvestigateBox {
  id: number
  startIndex: number
  endIndex: number
  /** End index (inclusive) of the optional "after the fact" range that starts right after this box's endIndex. Null when not set. */
  resultEndIndex: number | null
}

const rangeInvestigateModeActive = ref(false)
const rangeInvestigateBoxes = ref<RangeInvestigateBox[]>([])
let rangeInvestigateIdCounter = 0

const rangeInvestigateDragging = ref(false)
const rangeInvestigateStartIndex = ref<number | null>(null)
const rangeInvestigateEndIndex = ref<number | null>(null)

// Which box's investigation is currently shown in the modal — lets the
// "Download Data" button in the modal know which box (and which optional
// after-the-fact result range) to export.
const currentInvestigateBoxId = ref<number | null>(null)
const currentInvestigateBox = computed(() => {
  if (currentInvestigateBoxId.value === null) return null
  return findRangeInvestigateBox(currentInvestigateBoxId.value) ?? null
})

// ── "Add Result Range" tool: after investigating a range, lets the user
// mark a second, adjacent range starting right after it ends (endIndex+1)
// to capture "what happened after" for later download/training data.
const rangeInvestigateAddingResultRangeId = ref<number | null>(null)
const rangeInvestigateResultDragging = ref(false)
const rangeInvestigateResultDragEndIndex = ref<number | null>(null)

function toggleRangeInvestigateMode() {
  rangeInvestigateModeActive.value = !rangeInvestigateModeActive.value
}

function removeRangeInvestigateBox(id: number) {
  rangeInvestigateBoxes.value = rangeInvestigateBoxes.value.filter(b => b.id !== id)
  if (currentInvestigateBoxId.value === id) currentInvestigateBoxId.value = null
  if (rangeInvestigateAddingResultRangeId.value === id) rangeInvestigateAddingResultRangeId.value = null
}

function findRangeInvestigateBox(id: number): RangeInvestigateBox | undefined {
  return rangeInvestigateBoxes.value.find(b => b.id === id)
}

/** Arms "pick the end candle" mode for this box's after-the-fact result range. The start is always fixed at box.endIndex + 1. */
function startAddResultRange(id: number) {
  const box = findRangeInvestigateBox(id)
  if (!box) return
  rangeInvestigateAddingResultRangeId.value = rangeInvestigateAddingResultRangeId.value === id ? null : id
}

function clearResultRange(id: number) {
  const box = findRangeInvestigateBox(id)
  if (box) box.resultEndIndex = null
}

function startRangeInvestigateResizeLeft(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const box = findRangeInvestigateBox(id)
  if (!box) return

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.round(raw)
    box.startIndex = Math.max(0, Math.min(snapped, box.endIndex - 1))
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

function startRangeInvestigateResizeRight(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const box = findRangeInvestigateBox(id)
  if (!box) return

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.max(0, Math.min(displayCandles.value.length - 1, Math.round(raw)))
    box.endIndex = Math.max(box.startIndex + 1, snapped)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Same geometry approach as computeRangeDownloadBoxGeometry — kept as a separate function so the two tools' boxes never share mutable state. */
function computeRangeInvestigateBoxGeometry(startIndex: number, endIndex: number) {
  const candles = displayCandles.value.slice(startIndex, endIndex + 1)
  if (candles.length === 0) return null

  let rangeLow = Infinity
  let rangeHigh = -Infinity
  for (const c of candles) {
    if (c.low == null || c.high == null) continue
    if (c.low < rangeLow) rangeLow = c.low
    if (c.high > rangeHigh) rangeHigh = c.high
  }
  if (!isFinite(rangeLow) || !isFinite(rangeHigh) || rangeHigh <= rangeLow) return null

  return {
    leftX: candleX(startIndex) - candleWidth.value / 2,
    rightX: candleX(endIndex) + candleWidth.value / 2,
    rangeTop: priceToY(rangeHigh),
    rangeBottom: priceToY(rangeLow),
  }
}

const renderedRangeInvestigateBoxes = computed(() => {
  return rangeInvestigateBoxes.value
    .map(b => {
      const geo = computeRangeInvestigateBoxGeometry(b.startIndex, b.endIndex)
      return geo ? { ...geo, id: b.id, startIndex: b.startIndex, endIndex: b.endIndex } : null
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
})

const draggingRangeInvestigatePreview = computed(() => {
  if (!rangeInvestigateDragging.value || rangeInvestigateStartIndex.value === null || rangeInvestigateEndIndex.value === null) return null
  const s = Math.min(rangeInvestigateStartIndex.value, rangeInvestigateEndIndex.value)
  const e = Math.max(rangeInvestigateStartIndex.value, rangeInvestigateEndIndex.value)
  if (e <= s) return null
  return computeRangeInvestigateBoxGeometry(s, e)
})

function handleCandleMouseDownForRangeInvestigate(index: number, event: MouseEvent) {
  if (!rangeInvestigateModeActive.value) return
  event.preventDefault()
  event.stopPropagation()

  rangeInvestigateDragging.value = true
  rangeInvestigateStartIndex.value = index
  rangeInvestigateEndIndex.value = index

  const handleMove = (moveEvent: MouseEvent) => {
    if (!rangeInvestigateDragging.value || !chartContainer.value) return
    const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
    if (!rect) return
    const x = moveEvent.clientX - rect.left
    const rawIndex = Math.round((x - 10 - candleWidth.value / 2) / (candleWidth.value + candleGap))
    rangeInvestigateEndIndex.value = Math.max(0, Math.min(displayCandles.value.length - 1, rawIndex))
  }

  const handleUp = () => {
    if (rangeInvestigateStartIndex.value !== null && rangeInvestigateEndIndex.value !== null) {
      const s = Math.min(rangeInvestigateStartIndex.value, rangeInvestigateEndIndex.value)
      const e = Math.max(rangeInvestigateStartIndex.value, rangeInvestigateEndIndex.value)
      if (e > s) {
        rangeInvestigateBoxes.value.push({ id: ++rangeInvestigateIdCounter, startIndex: s, endIndex: e, resultEndIndex: null })
      }
    }
    rangeInvestigateDragging.value = false
    rangeInvestigateStartIndex.value = null
    rangeInvestigateEndIndex.value = null
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Geometry for each box's after-the-fact "Result Range" (endIndex+1 → resultEndIndex), when set. */
const renderedResultRangeBoxes = computed(() => {
  return rangeInvestigateBoxes.value
    .filter(b => b.resultEndIndex !== null && b.resultEndIndex > b.endIndex)
    .map(b => {
      const geo = computeRangeInvestigateBoxGeometry(b.endIndex + 1, b.resultEndIndex!)
      return geo ? { ...geo, id: b.id, startIndex: b.endIndex + 1, endIndex: b.resultEndIndex! } : null
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
})

/** Live drag preview while picking a Result Range's end candle. */
const draggingResultRangePreview = computed(() => {
  if (
    !rangeInvestigateResultDragging.value ||
    rangeInvestigateAddingResultRangeId.value === null ||
    rangeInvestigateResultDragEndIndex.value === null
  ) return null
  const box = findRangeInvestigateBox(rangeInvestigateAddingResultRangeId.value)
  if (!box) return null
  const fixedStart = box.endIndex + 1
  const e = rangeInvestigateResultDragEndIndex.value
  if (e < fixedStart) return null
  return computeRangeInvestigateBoxGeometry(fixedStart, e)
})

/** Click-drag on a candle after arming "Add Result Range" — start is pinned at box.endIndex + 1, drag picks the end candle. */
function handleCandleMouseDownForResultRange(id: number, index: number, event: MouseEvent) {
  const box = findRangeInvestigateBox(id)
  if (!box) {
    rangeInvestigateAddingResultRangeId.value = null
    return
  }
  const fixedStart = box.endIndex + 1
  if (fixedStart > displayCandles.value.length - 1) {
    rangeInvestigateAddingResultRangeId.value = null
    return
  }

  event.preventDefault()
  event.stopPropagation()

  rangeInvestigateResultDragging.value = true
  rangeInvestigateResultDragEndIndex.value = Math.max(fixedStart, index)

  const handleMove = (moveEvent: MouseEvent) => {
    if (!rangeInvestigateResultDragging.value || !chartContainer.value) return
    const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
    if (!rect) return
    const x = moveEvent.clientX - rect.left
    const rawIndex = Math.round((x - 10 - candleWidth.value / 2) / (candleWidth.value + candleGap))
    rangeInvestigateResultDragEndIndex.value = Math.max(fixedStart, Math.min(displayCandles.value.length - 1, rawIndex))
  }

  const handleUp = () => {
    if (rangeInvestigateResultDragEndIndex.value !== null) {
      box.resultEndIndex = rangeInvestigateResultDragEndIndex.value
    }
    rangeInvestigateResultDragging.value = false
    rangeInvestigateResultDragEndIndex.value = null
    rangeInvestigateAddingResultRangeId.value = null
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/**
 * Builds the exportable payload for one Range Download box. Pulls straight
 * from the chart's own reactive state rather than re-fetching anything:
 *   - candles:            raw OHLCV + ema200, one entry per candle in range
 *   - anchoredVwaps:      each placed AVWAP's mid/upper/lower points that
 *                         fall inside this range (skipped if none do)
 *   - fixedRangeVolumeProfiles: any placed FRVP whose own [start,end] span
 *                         overlaps this range, with its own POC/buckets
 *                         (its range is NOT clipped to the selection — a
 *                         volume profile only means something over the
 *                         span it was actually built from)
 *   - each candle also carries its own openInterest and longShortRatio
 *     sample (same as-of values already driving the OI/LS panels)
 */
function buildRangeExportPayload(id: number) {
  const box = findRangeDownloadBox(id)
  if (!box) return null
  const { startIndex, endIndex } = box

  const candles = displayCandles.value.slice(startIndex, endIndex + 1).map((c, i) => {
    const idx = startIndex + i
    const oi = oiPerCandle.value[idx] ?? null
    const ls = lsRatioPerCandle.value[idx] ?? null
    return {
      index: idx,
      openTime: c.openTime,
      openTimeIso: c.openTime ? new Date(c.openTime).toISOString() : null,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      ema200: c.candleData?.ema200 ?? null,
      openInterest: oi,
      longShortRatio: ls ? { longAccount: ls.longAccount, shortAccount: ls.shortAccount } : null,
    }
  })

  const anchoredVwapsInRange = anchoredVwapSeries.value
    .map(a => {
      const points = a.points.filter(p => p.index >= startIndex && p.index <= endIndex)
      if (points.length === 0) return null
      return {
        id: a.id,
        anchorIndex: a.anchorIndex,
        isOpenEnded: a.isOpenEnded,
        points: points.map(p => ({
          index: p.index,
          openTimeIso: displayCandles.value[p.index]?.openTime
            ? new Date(displayCandles.value[p.index].openTime!).toISOString()
            : null,
          mid: p.mid,
          upper: p.upper,
          lower: p.lower,
        })),
      }
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)

  const fixedRangeVolumeProfilesInRange = volumeProfiles.value
    .filter(meta => meta.startIndex <= endIndex && meta.endIndex >= startIndex)
    .map(meta => {
      const profile = computeVolumeProfile(meta.startIndex, meta.endIndex)
      if (!profile) return null
      return {
        ownRange: { startIndex: meta.startIndex, endIndex: meta.endIndex },
        rangeHighPrice: profile.rangeHighPrice,
        rangeLowPrice: profile.rangeLowPrice,
        pocPrice: profile.pocPrice,
        totalVolume: profile.totalVolume,
        buckets: profile.rows.map(r => ({
          priceLow: r.priceLow,
          priceHigh: r.priceHigh,
          buyVolume: r.buyVolume,
          sellVolume: r.sellVolume,
          totalVolume: r.buyVolume + r.sellVolume,
          isPoc: Math.abs((r.priceLow + r.priceHigh) / 2 - profile.pocPrice) < 1e-9,
        })),
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  return {
    symbol: props.symbol.toUpperCase(),
    interval: props.interval,
    generatedAt: new Date().toISOString(),
    range: {
      startIndex,
      endIndex,
      candleCount: candles.length,
    },
    candles,
    anchoredVwaps: anchoredVwapsInRange,
    fixedRangeVolumeProfiles: fixedRangeVolumeProfilesInRange,
  }
}

function downloadRangeData(id: number) {
  const payload = buildRangeExportPayload(id)
  if (!payload) return

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.symbol.toLowerCase()}_range_${payload.range.startIndex}-${payload.range.endIndex}_${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * "Analyze" on a Range Download box - runs the deterministic short-term
 * analyzer (rangeAnalyze.ts) over the EXACT SAME payload downloadRangeData()
 * would export for this box, and opens the result in the shared
 * DialogComponent. No separate data path from the download.
 */
function analyzeRangeData(id: number) {
  rangeAnalysisError.value = null
  rangeAnalysisResult.value = null
  showRangeAnalysis.value = true

  const payload = buildRangeExportPayload(id)
  if (!payload) {
    rangeAnalysisError.value = 'No range data to analyze - place/select a valid range box first.'
    return
  }

  rangeAnalysisLoading.value = true
  // Deterministic + synchronous, but defer a tick so the dialog can paint
  // its loading state before the (fast) computation runs.
  setTimeout(() => {
    try {
      const input: RangeAnalysisInput = {
        ...payload,
        previewPosition: previewPosition.value
          ? {
              side: previewPosition.value.side,
              entryPrice: previewPosition.value.entryPrice,
              tpPrice: previewPosition.value.tpPrice,
              slPrice: previewPosition.value.slPrice,
            }
          : null,
      }
      rangeAnalysisResult.value = analyzeRange(input)
    } catch (err) {
      console.error('Range analysis failed:', err)
      rangeAnalysisError.value = err instanceof Error ? err.message : 'Range analysis failed.'
    } finally {
      rangeAnalysisLoading.value = false
    }
  }, 0)
}

// ─── Range Investigate: fetch + run ─────────────────────────────────────────
//
// Unlike Range Download's "Analyze" (fully synchronous off state already in
// memory), Investigate needs two things the chart doesn't otherwise fetch:
// large individual trades (aggTrades) inside the exact range window, and the
// most recent funding rate around that window. Both are small, single-shot
// REST calls fired only when the user clicks "Investigate" on a specific box.

/** How many candles of lookback (immediately before the selected range) to use as the "normal" volume/OI/LS baseline. */
const RANGE_INVESTIGATE_BASELINE_LOOKBACK = 20

/** Binance aggTrades in [startTime, endTime]. Paginates the same way spike_investigate.py does, capped generously since a chart-selected range is a bounded window (not an open-ended scan). */
async function fetchAggTradesForRange(symbol: string, startMs: number, endMs: number): Promise<LargeTradeInput[]> {
  const out: LargeTradeInput[] = []
  let cursor = startMs
  let guard = 0
  while (cursor < endMs && guard < 20) {
    guard++
    const url = `${REST_BASE}/fapi/v1/aggTrades?symbol=${symbol.toUpperCase()}&startTime=${cursor}&endTime=${endMs}&limit=1000`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`aggTrades request failed (${res.status})`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const t of batch) {
      out.push({
        time: t.T,
        price: parseFloat(t.p),
        qty: parseFloat(t.q),
        notional: parseFloat(t.p) * parseFloat(t.q),
        isBuyerMaker: Boolean(t.m),
      })
    }
    const lastT = batch[batch.length - 1].T
    if (lastT <= cursor) break
    cursor = lastT + 1
    if (batch.length < 1000) break
  }
  return out
}

/** Most recent Binance funding rate sample at/around the range's end time. Funding only settles every 8h, so we widen the lookback window well past the range itself to make sure at least one sample is caught. */
async function fetchFundingRateNear(symbol: string, endMs: number): Promise<number | null> {
  const startMs = endMs - 24 * 3600 * 1000
  const url = `${REST_BASE}/fapi/v1/fundingRate?symbol=${symbol.toUpperCase()}&startTime=${startMs}&endTime=${endMs}&limit=10`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fundingRate request failed (${res.status})`)
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null
  return parseFloat(data[data.length - 1].fundingRate)
}

/**
 * "🔍 Investigate" on a Range Investigate box — builds the same kind of
 * candle payload buildRangeExportPayload() does for Range Download, adds
 * baseline context (volume/OI/long-short from the candles just before the
 * range) plus two live fetches (aggTrades, fundingRate), then runs it all
 * through rangeInvestigate.ts and opens the result in the shared
 * DialogComponent.
 */
async function investigateRangeData(id: number) {
  rangeInvestigateError.value = null
  rangeInvestigateResult.value = null
  showRangeInvestigate.value = true
  currentInvestigateBoxId.value = id

  const box = findRangeInvestigateBox(id)
  if (!box) {
    rangeInvestigateError.value = 'No range data to investigate - place/select a valid range box first.'
    return
  }
  const { startIndex, endIndex } = box
  const rangeCandles = displayCandles.value.slice(startIndex, endIndex + 1)
  if (rangeCandles.length < 2) {
    rangeInvestigateError.value = 'Select at least 2 candles to investigate.'
    return
  }

  rangeInvestigateLoading.value = true
  try {
    const candles = rangeCandles.map((c, i) => {
      const idx = startIndex + i
      const oi = oiPerCandle.value[idx] ?? null
      const ls = lsRatioPerCandle.value[idx] ?? null
      const movement = movementPerCandle.value[idx]
      return {
        index: idx,
        openTime: c.openTime ?? null,
        openTimeIso: c.openTime ? new Date(c.openTime).toISOString() : null,
        open: c.open!,
        high: c.high!,
        low: c.low!,
        close: c.close!,
        volume: c.volume ?? 0,
        ema200: c.candleData?.ema200 ?? null,
        openInterest: oi,
        longShortRatio: ls ? { longAccount: ls.longAccount, shortAccount: ls.shortAccount } : null,
        inflow: movement?.inflow ?? 0,
        outflow: movement?.outflow ?? 0,
      }
    })

    // Baseline context from the lookback window immediately before the range.
    const baselineStart = Math.max(0, startIndex - RANGE_INVESTIGATE_BASELINE_LOOKBACK)
    const baselineCandles = displayCandles.value.slice(baselineStart, startIndex)
    const baselineAvgVolume = baselineCandles.length
      ? baselineCandles.reduce((s, c) => s + (c.volume ?? 0), 0) / baselineCandles.length
      : null
    const baselineOiBefore = startIndex > 0 ? (oiPerCandle.value[startIndex - 1] ?? null) : null
    const baselineLs = startIndex > 0 ? lsRatioPerCandle.value[startIndex - 1] : null
    const baselineLongAccountBefore = baselineLs ? baselineLs.longAccount : null
    // Same lookback window as volume/OI above, but for wallet inflow/outflow — only
    // meaningful once movementPerCandle has actually been populated (wallet movement fetched).
    const baselineMovementBuckets = baselineStart < startIndex
      ? movementPerCandle.value.slice(baselineStart, startIndex)
      : []
    const hasMovementData = movementPerCandle.value.some(b => b.records.length > 0)
    const baselineAvgInflow = hasMovementData && baselineMovementBuckets.length
      ? baselineMovementBuckets.reduce((s, b) => s + b.inflow, 0) / baselineMovementBuckets.length
      : null
    const baselineAvgOutflow = hasMovementData && baselineMovementBuckets.length
      ? baselineMovementBuckets.reduce((s, b) => s + b.outflow, 0) / baselineMovementBuckets.length
      : null

    // Exact time span of the selected range, for the aggTrades/funding fetches.
    const rangeStartMs = rangeCandles[0].openTime ?? null
    const rangeEndMs = rangeCandles[rangeCandles.length - 1].openTime != null
      ? rangeCandles[rangeCandles.length - 1].openTime! + intervalToMs(props.interval)
      : null

    let largeTrades: LargeTradeInput[] = []
    let fundingRate: number | null = null
    if (rangeStartMs != null && rangeEndMs != null) {
      const [tradesResult, fundingResult] = await Promise.allSettled([
        fetchAggTradesForRange(props.symbol, rangeStartMs, rangeEndMs),
        fetchFundingRateNear(props.symbol, rangeEndMs),
      ])
      if (tradesResult.status === 'fulfilled') largeTrades = tradesResult.value
      else console.error('aggTrades fetch failed:', tradesResult.reason)
      if (fundingResult.status === 'fulfilled') fundingRate = fundingResult.value
      else console.error('fundingRate fetch failed:', fundingResult.reason)
    }

    const input: RangeInvestigateInput = {
      symbol: props.symbol.toUpperCase(),
      interval: props.interval,
      candles,
      baselineAvgVolume,
      baselineOiBefore,
      baselineLongAccountBefore,
      baselineAvgInflow,
      baselineAvgOutflow,
      fundingRate,
      largeTrades,
      previewPosition: previewPosition.value
        ? {
            side: previewPosition.value.side,
            entryPrice: previewPosition.value.entryPrice,
            tpPrice: previewPosition.value.tpPrice,
            slPrice: previewPosition.value.slPrice,
          }
        : null,
    }

    rangeInvestigateResult.value = investigateRange(input)
  } catch (err) {
    console.error('Range investigation failed:', err)
    rangeInvestigateError.value = err instanceof Error ? err.message : 'Range investigation failed.'
  } finally {
    rangeInvestigateLoading.value = false
  }
}

/** Same per-candle export shape used by investigateRangeData and buildRangeExportPayload — pulled out so the Range Investigate download can build it for both the investigated range and the optional after-the-fact range without duplicating the mapping twice. */
function mapInvestigateCandlesForExport(startIndex: number, endIndex: number) {
  return displayCandles.value.slice(startIndex, endIndex + 1).map((c, i) => {
    const idx = startIndex + i
    const oi = oiPerCandle.value[idx] ?? null
    const ls = lsRatioPerCandle.value[idx] ?? null
    const movement = movementPerCandle.value[idx]
    return {
      index: idx,
      openTime: c.openTime ?? null,
      openTimeIso: c.openTime ? new Date(c.openTime).toISOString() : null,
      open: c.open!,
      high: c.high!,
      low: c.low!,
      close: c.close!,
      volume: c.volume ?? 0,
      ema200: c.candleData?.ema200 ?? null,
      openInterest: oi,
      longShortRatio: ls ? { longAccount: ls.longAccount, shortAccount: ls.shortAccount } : null,
      inflow: movement?.inflow ?? 0,
      outflow: movement?.outflow ?? 0,
    }
  })
}

/**
 * Builds the { investigation_result, investigation_range, after_the_fact_range }
 * payload for a Range Investigate box's "Download Data" button. The
 * investigation_result is whatever's currently in rangeInvestigateResult
 * (the analysis already shown in the modal) — this does not re-run the
 * investigation. after_the_fact_range is null when no Result Range has
 * been marked for this box yet.
 */
function buildInvestigateExportPayload(id: number) {
  const box = findRangeInvestigateBox(id)
  if (!box) return null

  const investigationCandles = mapInvestigateCandlesForExport(box.startIndex, box.endIndex)
  const hasResultRange = box.resultEndIndex !== null && box.resultEndIndex > box.endIndex
  const afterTheFactCandles = hasResultRange
    ? mapInvestigateCandlesForExport(box.endIndex + 1, box.resultEndIndex!)
    : []

  return {
    investigation_result: rangeInvestigateResult.value,
    investigation_range: {
      symbol: props.symbol.toUpperCase(),
      interval: props.interval,
      startIndex: box.startIndex,
      endIndex: box.endIndex,
      candleCount: investigationCandles.length,
      candles: investigationCandles,
    },
    after_the_fact_range: hasResultRange
      ? {
          symbol: props.symbol.toUpperCase(),
          interval: props.interval,
          startIndex: box.endIndex + 1,
          endIndex: box.resultEndIndex,
          candleCount: afterTheFactCandles.length,
          candles: afterTheFactCandles,
        }
      : null,
  }
}

/** "⬇ Download Data" in the Range Investigate modal — exports the analysis already shown, plus the investigated range and (if set) the after-the-fact result range, as one JSON file. */
function downloadInvestigateData() {
  const id = currentInvestigateBoxId.value
  if (id === null) return
  const payload = buildInvestigateExportPayload(id)
  if (!payload) return

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.symbol.toLowerCase()}_investigate_${payload.investigation_range.startIndex}-${payload.investigation_range.endIndex}_${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Small pause between queued OI fetches so "Fill PZ VP" doesn't burst-fire one request per zone. */
const VP_FILL_OI_THROTTLE_MS = 300

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * "Fill PZ VP" — auto-places one Fixed-Range Volume Profile per Price Zone,
 * instead of hand-dragging a VP box over each zone. Walks displayCandles
 * the same way zoneRectangles does to find each zone's [startIndex, endIndex]
 * (grouped by candle.priceZone, CANDLES_PER_ZONE candles per zone), then
 * replaces whatever VP boxes are currently placed with a fresh one per zone.
 *
 * The VP boxes themselves all appear at once (computeVolumeProfile is
 * synchronous, driven off candles already in memory). Only the per-zone OI
 * rate lookups are network calls, and those are awaited one at a time with
 * a throttle delay between them — otherwise filling, say, 15 zones would
 * fire 15 concurrent OI requests and risk tripping the API's rate limit.
 */
async function fillPriceZonesWithVolumeProfile() {
  const ranges: { startIndex: number; endIndex: number }[] = []
  let currentZone: CandleEntry['priceZone'] | null = null
  let zoneStartIndex = 0

  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.priceZone && (!currentZone || JSON.stringify(currentZone) !== JSON.stringify(candle.priceZone))) {
      if (currentZone) {
        ranges.push({ startIndex: zoneStartIndex, endIndex: i - 1 })
      }
      currentZone = candle.priceZone
      zoneStartIndex = i
    }
  }
  if (currentZone) {
    const zoneEndIndex = Math.min(zoneStartIndex + CANDLES_PER_ZONE - 1, displayCandles.value.length - 1)
    ranges.push({ startIndex: zoneStartIndex, endIndex: zoneEndIndex })
  }

  // Wipe whatever's currently placed so zones don't stack duplicate VPs on repeat clicks.
  for (const p of volumeProfiles.value) { delete vpOiRates.value[p.id]; delete vpAnalysis.value[p.id] }
  volumeProfiles.value = []

  // Place every VP box up front (instant, no network) so the chart fills in immediately...
  const placed: { id: number; startIndex: number; endIndex: number }[] = []
  for (const { startIndex, endIndex } of ranges) {
    if (endIndex <= startIndex) continue
    const id = ++vpIdCounter
    volumeProfiles.value.push({ id, startIndex, endIndex })
    placed.push({ id, startIndex, endIndex })
  }

  // ...then fetch OI rates one zone at a time, throttled, instead of all at once.
  for (const { id, startIndex, endIndex } of placed) {
    await loadOiRateForProfile(id, startIndex, endIndex)
    await delay(VP_FILL_OI_THROTTLE_MS)
  }
}

/**
 * "VP Volume Spikes" — walks the volume-spike candles in chronological order
 * (oldest first) and collapses them into a sequence of alternating swing
 * pivots, placing one Fixed-Range Volume Profile per leg between pivots:
 *
 *   - Each new spike either extends the leg currently in progress (a new
 *     low while we're hunting lows, or a new high while hunting highs) —
 *     the leg's end just keeps moving out to "the latest lowest" (or
 *     highest), no new VP yet.
 *   - Or it opposes the current leg. Before accepting it as a genuine
 *     reversal, check whether it fully retraces the leg BEFORE the current
 *     one — i.e. it breaks back past the point where the current leg
 *     started. If so, the current leg was just a blip, never a real swing:
 *     collapse it away and re-test the new spike against what's now on top
 *     (this can cascade through several blips in a row). Otherwise it's a
 *     confirmed new pivot and starts the next leg.
 *
 * This is different from "Connect volume spikes" (the orange line), which
 * just connects every spike in order — this only draws a VP boundary at
 * swings that actually hold, so a brief bounce that gets erased by a
 * deeper low right after doesn't spawn its own tiny VP; it just gets
 * absorbed into the leg that was already extending.
 */
async function fillVolumeSpikesWithVolumeProfile() {
  const spikes: { index: number; close: number }[] = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.candleData?.volumeSpike && candle.close != null) {
      spikes.push({ index: i, close: candle.close })
    }
  }
  if (spikes.length < 2) return

  // `pivots` holds indices into `spikes` for the confirmed swing points found
  // so far, oldest first. Processing each new spike either extends the last
  // pivot in place, cascades back popping blips that got fully retraced, or
  // confirms a genuine new pivot.
  const pivots: number[] = [0]
  for (let i = 1; i < spikes.length; i++) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (pivots.length < 2) {
        pivots.push(i)
        break
      }
      const prevPivot = spikes[pivots[pivots.length - 2]]
      const top = spikes[pivots[pivots.length - 1]]
      const risingLeg = top.close > prevPivot.close

      const continuesLeg = risingLeg
        ? spikes[i].close >= top.close
        : spikes[i].close <= top.close
      if (continuesLeg) {
        pivots[pivots.length - 1] = i // still making a new high/low — extend this leg's end
        break
      }

      const fullyRetraced = risingLeg
        ? spikes[i].close <= prevPivot.close
        : spikes[i].close >= prevPivot.close
      if (fullyRetraced) {
        pivots.pop() // this pivot was never a real swing — collapse it and re-test against the prior one
        continue
      }

      pivots.push(i) // confirmed reversal — genuine new pivot
      break
    }
  }

  const ranges: { startIndex: number; endIndex: number }[] = []
  for (let k = 0; k < pivots.length - 1; k++) {
    ranges.push({
      startIndex: spikes[pivots[k]].index,
      endIndex: spikes[pivots[k + 1]].index,
    })
  }

  // Wipe whatever's currently placed so repeat clicks don't stack duplicate VPs.
  for (const p of volumeProfiles.value) { delete vpOiRates.value[p.id]; delete vpAnalysis.value[p.id] }
  volumeProfiles.value = []

  // Place every VP box up front (instant, no network)...
  const placed: { id: number; startIndex: number; endIndex: number }[] = []
  for (const { startIndex, endIndex } of ranges) {
    if (endIndex <= startIndex) continue
    const id = ++vpIdCounter
    volumeProfiles.value.push({ id, startIndex, endIndex })
    placed.push({ id, startIndex, endIndex })
  }

  // ...then fetch OI rates one leg at a time, throttled, instead of all at once.
  for (const { id, startIndex, endIndex } of placed) {
    await loadOiRateForProfile(id, startIndex, endIndex)
    await delay(VP_FILL_OI_THROTTLE_MS)
  }
}

/**
 * Builds a Fixed-Range Volume Profile for candles [startIndex, endIndex].
 * Returns null if the range is empty or degenerate.
 */
function computeVolumeProfile(startIndex: number, endIndex: number) {
  const candles = displayCandles.value.slice(startIndex, endIndex + 1)
  if (candles.length === 0) return null

  let rangeLow = Infinity
  let rangeHigh = -Infinity
  for (const c of candles) {
    if (c.low == null || c.high == null) continue
    if (c.low < rangeLow) rangeLow = c.low
    if (c.high > rangeHigh) rangeHigh = c.high
  }
  if (!isFinite(rangeLow) || !isFinite(rangeHigh) || rangeHigh <= rangeLow) return null

  const bucketHeight = (rangeHigh - rangeLow) / VP_NUM_BUCKETS
  const buckets = Array.from({ length: VP_NUM_BUCKETS }, (_, i) => ({
    priceLow: rangeLow + i * bucketHeight,
    priceHigh: rangeLow + (i + 1) * bucketHeight,
    buyVolume: 0,
    sellVolume: 0,
  }))

  for (const c of candles) {
    const low = c.low
    const high = c.high
    const vol = c.volume ?? 0
    if (low == null || high == null || vol <= 0 || high <= low) continue
    const isBull = (c.close ?? 0) >= (c.open ?? 0)
    for (const b of buckets) {
      const overlapLow = Math.max(low, b.priceLow)
      const overlapHigh = Math.min(high, b.priceHigh)
      if (overlapHigh > overlapLow) {
        const frac = (overlapHigh - overlapLow) / (high - low)
        const v = vol * frac
        if (isBull) b.buyVolume += v
        else b.sellVolume += v
      }
    }
  }

  let maxRowTotal = 0
  let pocIndex = 0
  buckets.forEach((b, i) => {
    const total = b.buyVolume + b.sellVolume
    if (total > maxRowTotal) {
      maxRowTotal = total
      pocIndex = i
    }
  })

  // Profile is drawn *inside* the selected range box, bars growing rightward
  // from the box's left edge so they sit over the candles instead of
  // floating off to the right of the chart.
  const leftEdgeX = candleX(startIndex) - candleWidth.value / 2
  const boxRightX = candleX(endIndex) + candleWidth.value / 2
  const barMaxWidth = Math.min(VP_MAX_BAR_WIDTH, Math.max(boxRightX - leftEdgeX - 4, 0))

  const rows = buckets.map(b => {
    const total = b.buyVolume + b.sellVolume
    const totalWidth = maxRowTotal > 0 ? (total / maxRowTotal) * barMaxWidth : 0
    const buyWidth = total > 0 ? totalWidth * (b.buyVolume / total) : 0
    const sellWidth = totalWidth - buyWidth
    return {
      x: leftEdgeX + 2,
      y: priceToY(b.priceHigh),
      height: Math.max(priceToY(b.priceLow) - priceToY(b.priceHigh), 0.5),
      buyWidth,
      sellWidth,
      buyVolume: b.buyVolume,
      sellVolume: b.sellVolume,
      priceLow: b.priceLow,
      priceHigh: b.priceHigh,
    }
  })

  const pocBucket = buckets[pocIndex]
  const pocPrice = (pocBucket.priceLow + pocBucket.priceHigh) / 2
  const totalBuyVolume = buckets.reduce((s, b) => s + b.buyVolume, 0)
  const totalSellVolume = buckets.reduce((s, b) => s + b.sellVolume, 0)
  const totalVolume = totalBuyVolume + totalSellVolume
  const buyPct = totalVolume > 0 ? (totalBuyVolume / totalVolume) * 100 : 0
  const sellPct = totalVolume > 0 ? (totalSellVolume / totalVolume) * 100 : 0

  return {
    startIndex,
    endIndex,
    leftX: leftEdgeX,
    rightX: boxRightX,
    rangeTop: priceToY(rangeHigh),
    rangeBottom: priceToY(rangeLow),
    rangeHighPrice: rangeHigh,
    rangeLowPrice: rangeLow,
    rows,
    pocY: priceToY(pocPrice),
    pocPrice,
    totalVolume,
    totalBuyVolume,
    totalSellVolume,
    buyPct,
    sellPct,
  }
}

/**
 * Builds the exportable payload for a single placed FRVP range - the raw
 * OHLCV candles it covers, the computed volume profile (POC, per-bucket
 * buy/sell volume with real price bounds), and the OI rate fetched for that
 * same window. Shared by the single-profile download button and the
 * "Download FRVPs" (all-profiles zip) button below. Field names are kept
 * explicit/self-describing (rather than matching the internal
 * render-oriented shape - pixel x/y, widths, etc. are omitted) since this
 * is meant to be handed directly to an LLM for analysis.
 */
function buildFrvpExportPayload(id: number) {
  const meta = findVolumeProfile(id)
  const profile = renderedVolumeProfiles.value.find(p => p.id === id)
  if (!meta || !profile) return null

  const candles = displayCandles.value.slice(meta.startIndex, meta.endIndex + 1).map(c => ({
    openTime: c.openTime,
    openTimeIso: c.openTime ? new Date(c.openTime).toISOString() : null,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))

  const oiState = vpOiRates.value[id]
  const analysisState = vpAnalysis.value[id]

  return {
    symbol: props.symbol.toUpperCase(),
    interval: props.interval,
    generatedAt: new Date().toISOString(),
    range: {
      startIndex: meta.startIndex,
      endIndex: meta.endIndex,
      candleCount: candles.length,
    },
    candles,
    fixedRangeVolumeProfile: {
      rangeHighPrice: profile.rangeHighPrice,
      rangeLowPrice: profile.rangeLowPrice,
      pocPrice: profile.pocPrice,
      totalVolume: profile.totalVolume,
      buckets: profile.rows.map(r => ({
        priceLow: r.priceLow,
        priceHigh: r.priceHigh,
        buyVolume: r.buyVolume,
        sellVolume: r.sellVolume,
        totalVolume: r.buyVolume + r.sellVolume,
        isPoc: Math.abs((r.priceLow + r.priceHigh) / 2 - profile.pocPrice) < 1e-9,
      })),
    },
    openInterest:
      oiState?.status === 'ready'
        ? {
            status: 'ready',
            startOi: oiState.data!.startOi,
            endOi: oiState.data!.endOi,
            oiChangeAbs: oiState.data!.oiChangeAbs,
            oiChangePct: oiState.data!.oiChangePct,
            ratePerHour: oiState.data!.ratePerHour,
            period: oiState.data!.period,
            pointCount: oiState.data!.pointCount,
          }
        : { status: oiState?.status ?? 'not-fetched', error: oiState?.error },
    biasAnalysis:
      analysisState?.status === 'ready'
        ? {
            status: 'ready',
            bias: analysisState.bias,
            confidencePct: analysisState.confidencePct,
          }
        : { status: analysisState?.status ?? 'not-run' },
  }
}

function downloadProfileData(id: number) {
  const payload = buildFrvpExportPayload(id)
  if (!payload) return

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.symbol.toLowerCase()}_frvp_${payload.range.startIndex}-${payload.range.endIndex}_${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * "Download FRVPs" - zips the export payload of every currently placed FRVP
 * into a single .zip (one JSON file per profile, ordered left-to-right by
 * startIndex), plus a manifest.json summarizing the batch and a README.txt
 * with the prompt-ready structure explanation. Requires the `jszip` package
 * (npm install jszip) - add it to the project if it isn't already there.
 */
async function downloadAllFrvpZip() {
  if (volumeProfiles.value.length === 0) return

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  const sorted = [...volumeProfiles.value].sort((a, b) => a.startIndex - b.startIndex)
  const fileEntries: {
    file: string
    startIndex: number
    endIndex: number
    candleCount: number
    bias: string | null
    biasConfidencePct: number | null
  }[] = []

  sorted.forEach((meta, i) => {
    const payload = buildFrvpExportPayload(meta.id)
    if (!payload) return
    const fileName = `frvp_${String(i + 1).padStart(2, '0')}_${meta.startIndex}-${meta.endIndex}.json`
    zip.file(fileName, JSON.stringify(payload, null, 2))
    fileEntries.push({
      file: fileName,
      startIndex: meta.startIndex,
      endIndex: meta.endIndex,
      candleCount: payload.range.candleCount,
      bias: payload.biasAnalysis.status === 'ready' ? payload.biasAnalysis.bias! : null,
      biasConfidencePct: payload.biasAnalysis.status === 'ready' ? payload.biasAnalysis.confidencePct! : null,
    })
  })

  const manifest = {
    symbol: props.symbol.toUpperCase(),
    interval: props.interval,
    generatedAt: new Date().toISOString(),
    profileCount: fileEntries.length,
    orderedOldestToNewest: true,
    files: fileEntries,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('README.txt', FRVP_ZIP_README)

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.symbol.toLowerCase()}_frvps_${Date.now()}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const FRVP_ZIP_README = `This zip contains Fixed-Range Volume Profiles (FRVPs) exported from the chart.

FILES
- manifest.json          Batch summary: symbol, interval, and the ordered list of
                          FRVP files (oldest range first, by startIndex), each with
                          its bias/confidence at a glance (bias, biasConfidencePct).
- frvp_NN_start-end.json One file per FRVP box placed on the chart, NN = order
                          (01, 02, ...), start-end = candle index range it covers.

EACH frvp_NN_*.json FILE SHAPE
{
  "symbol": string,
  "interval": string,              // candle interval, e.g. "15m"
  "generatedAt": ISO timestamp,
  "range": { "startIndex", "endIndex", "candleCount" },
  "candles": [                     // raw OHLCV for every candle in this FRVP's range, oldest first
    { "openTime", "openTimeIso", "open", "high", "low", "close", "volume" }
  ],
  "fixedRangeVolumeProfile": {
    "rangeHighPrice", "rangeLowPrice",
    "pocPrice",                    // Point of Control: price level with the most total volume
    "totalVolume",
    "buckets": [                   // price rows across the range, low to high
      { "priceLow", "priceHigh", "buyVolume", "sellVolume", "totalVolume", "isPoc" }
    ]
  },
  "openInterest": {
    "status": "ready" | "no-data" | "error" | "not-fetched",
    "startOi", "endOi", "oiChangeAbs", "oiChangePct", "ratePerHour", "period", "pointCount"
  },
  "biasAnalysis": {
    "status": "ready" | "analyzing" | "error" | "insufficient" | "not-run",
    "bias",                        // "LONG" | "SHORT" | "NEUTRAL" (only present when status is "ready")
    "confidencePct"                // 0-100 (only present when status is "ready")
  }
}

biasAnalysis is the confluence-analyzer's read on this zone, computed from every
FRVP from the oldest placed up through this one (inclusive) - so it reflects the
full picture built up to this point in time, not this zone in isolation. It's the
same bias/confidence shown on the chart just under each FRVP's OI line.

Each FRVP is one price zone from the chart: its own candle range, its own volume
profile (where volume built up within that range), and its own OI change over that
same window. Consecutive files (frvp_01, frvp_02, ...) are consecutive zones in time.
`

/**
 * "Analyze FRVPs" - runs the confluence analyzer (analyzeFrvps.ts) over every
 * currently placed FRVP, oldest to newest, and opens the result in a modal.
 * Reuses buildFrvpExportPayload() so the analyzer sees exactly the same
 * candles/profile/OI data as the JSON/zip exports - no separate data path.
 */
function runFrvpAnalysis() {
  if (volumeProfiles.value.length === 0) return

  const sorted = [...volumeProfiles.value].sort((a, b) => a.startIndex - b.startIndex)
  const zoneInputs: FrvpZoneInput[] = []

  for (const meta of sorted) {
    const payload = buildFrvpExportPayload(meta.id)
    if (!payload) continue
    zoneInputs.push({
      id: meta.id,
      startIndex: payload.range.startIndex,
      endIndex: payload.range.endIndex,
      candles: payload.candles,
      fixedRangeVolumeProfile: payload.fixedRangeVolumeProfile,
      openInterest: payload.openInterest as FrvpZoneInput['openInterest'],
    })
  }

  frvpAnalysisResult.value = analyzeFrvps(zoneInputs, {
    symbol: props.symbol.toUpperCase(),
    interval: props.interval,
  })
  showFrvpAnalysis.value = true
}

function oiLabelText(id: number): string {
  const state = vpOiRates.value[id]
  if (!state || state.status === 'loading') return 'OI: loading...'
  if (state.status === 'error') return 'OI: fetch failed'
  if (state.status === 'no-data') return 'OI: no data for range'
  const d = state.data!
  const sign = d.oiChangePct >= 0 ? '+' : ''
  return `OI ${sign}${d.oiChangePct.toFixed(2)}% (${sign}${d.ratePerHour.toFixed(2)}%/hr)`
}

function oiLabelClass(id: number) {
  const state = vpOiRates.value[id]
  if (!state || state.status !== 'ready') return 'vp-oi-neutral'
  const pct = state.data!.oiChangePct
  if (pct > 1) return 'vp-oi-up'
  if (pct < -1) return 'vp-oi-down'
  return 'vp-oi-neutral'
}

function vpAnalysisLabelText(id: number): string {
  const state = vpAnalysis.value[id]
  if (!state || state.status === 'analyzing') return 'Bias: analyzing...'
  if (state.status === 'error') return 'Bias: analysis failed'
  if (state.status === 'insufficient') return 'Bias: n/a'
  return `${state.bias!.toLowerCase()} - ${state.confidencePct}%`
}

function vpAnalysisLabelClass(id: number) {
  const state = vpAnalysis.value[id]
  if (!state || state.status !== 'ready' || !state.bias) return 'vp-bias-neutral'
  const bias = state.bias.toLowerCase()
  if (bias === 'long') return 'vp-bias-long'
  if (bias === 'short') return 'vp-bias-short'
  return 'vp-bias-neutral'
}

/** All finalized (click-drag-completed) volume profiles, recomputed reactively as price scale/zoom changes. */
const renderedVolumeProfiles = computed(() => {
  return volumeProfiles.value
    .map(p => {
      const profile = computeVolumeProfile(p.startIndex, p.endIndex)
      return profile ? { ...profile, id: p.id } : null
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
})

/** Live preview of the profile while the user is still dragging. */
const draggingVolumeProfilePreview = computed(() => {
  if (!vpDragging.value || vpStartIndex.value === null || vpEndIndex.value === null) return null
  const s = Math.min(vpStartIndex.value, vpEndIndex.value)
  const e = Math.max(vpStartIndex.value, vpEndIndex.value)
  if (e <= s) return null
  return computeVolumeProfile(s, e)
})

const MAX_RECONNECT_DELAY_MS = 30_000

// ─── WebSocket / live candle (kline stream) ────────────────────────────────────
type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
const wsStatus = ref<WsStatus>('connecting')
const wsStatusLabel = computed(() => ({
  connecting:   'Connecting…',
  connected:    'Live',
  disconnected: 'Disconnected',
  error:        'Error',
}[wsStatus.value]))

/**
 * Partial CandleEntry overlay — only OHLC are live-patched; every other field
 * is inherited from the last candle in `props.candles`.
 */
const liveCandle = ref<CandleEntry | null>(null)

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 2_000

// ─── Polled volume for the in-progress candle ──────────────────────────────
// The kline stream's per-tick `v` field was noisy enough to blow up the AVWAP
// weighting (cumVol swinging with every tick), so price still comes straight
// off the socket (needs to feel live) but volume for the forming candle is
// instead pulled from REST every 30s — much more stable, and "off by up to
// 30s" is a fine trade-off for a value that's only ever a running total anyway.
const liveVolume = ref<number | null>(null)
let liveVolumePollTimer: ReturnType<typeof setInterval> | null = null
const LIVE_VOLUME_POLL_MS = 30_000

async function fetchLiveVolume() {
  try {
    const url = `${REST_BASE}/fapi/v1/klines?symbol=${props.symbol.toUpperCase()}&interval=${props.interval}&limit=1`
    const res = await fetch(url)
    if (!res.ok) return
    const data = await res.json()
    const latest = data?.[0]
    if (!latest) return
    const vol = parseFloat(latest[5]) // base asset volume, same field index used elsewhere
    if (!isNaN(vol)) liveVolume.value = vol
  } catch {
    // network hiccup — keep the last known volume, next 30s tick will retry
  }
}

function startLiveVolumePolling() {
  stopLiveVolumePolling()
  fetchLiveVolume() // don't wait a full 30s for the first value
  liveVolumePollTimer = setInterval(fetchLiveVolume, LIVE_VOLUME_POLL_MS)
}

function stopLiveVolumePolling() {
  if (liveVolumePollTimer !== null) {
    clearInterval(liveVolumePollTimer)
    liveVolumePollTimer = null
  }
}

function connectWebSocket() {
  if (ws) {
    ws.onclose = null   // prevent the reconnect handler from firing twice
    ws.close()
  }
 
  const streamName = `${props.symbol.toLowerCase()}@kline_${props.interval}`
  const url = `wss://fstream.binance.com/market/ws/${streamName}`
 
  wsStatus.value = 'connecting'
  ws = new WebSocket(url)
 
  ws.onopen = () => {
    wsStatus.value = 'connected'
    reconnectDelay = 2_000
  }

  // Runs independently of the socket's open/close state — cheap REST poll,
  // no reason to gate it on the price stream being connected.
  startLiveVolumePolling()
 
  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg: BinanceKlineMessage = JSON.parse(event.data as string)
      
      if (msg.e !== 'kline') return
 
      const k = msg.k
      const o = parseFloat(k.o)
      const h = parseFloat(k.h)
      const l = parseFloat(k.l)
      const c = parseFloat(k.c)
 
      
      // Guard: skip malformed frames — any NaN would collapse priceDelta to NaN
      if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) return
 
      const lastPropCandle = props.candles[props.candles.length - 1]
      if (!lastPropCandle) return
 
      if (k.t === lastPropCandle.openTime) {
        // Same bar as the last CLOSED candle we already have — this is just
        // an in-progress update to that same candle. Patch OHLC into a
        // shallow copy so all computed indicators (zones, SR, etc.) remain
        // intact. displayCandles() below will REPLACE the last candle with
        // this, not append it. Volume is NOT taken from the socket (the
        // per-tick `v` field was noisy enough to swing the AVWAP weighting)
        // — it's the 30s-polled REST value, falling back to the last known
        // candle's volume until the first poll lands.
        liveCandle.value = {
          ...lastPropCandle,
          openTime: k.t,
          open:  o,
          high:  h,
          low:   l,
          close: c,
          volume: liveVolume.value ?? lastPropCandle.volume,
        }
      } else if (k.t > lastPropCandle.openTime) {
        // The stream has rolled over to a genuinely new bar that isn't in
        // props.candles yet (parent hasn't caught up). This really is a new
        // candle — append it, but don't inherit analytic fields (support/
        // resistance, zones, candleData, etc.) from the old bar since those
        // don't apply to this new period.
        const { candleData: _omitCandleData, ...lastPropCandleWithoutAnalytics } = lastPropCandle
        // A new bar just opened — the old poll result belongs to the bar that
        // just closed, so it's stale for this one. Clear it and re-poll right
        // away instead of waiting up to 30s to find out this candle's real volume.
        liveVolume.value = null
        fetchLiveVolume()
        liveCandle.value = {
          ...lastPropCandleWithoutAnalytics,
          openTime: k.t,
          open:  o,
          high:  h,
          low:   l,
          close: c,
          volume: 0,
          support: null,
          resistance: null,
          // Intentionally omitted (not the old bar's candleData): a brand-new
          // bar has no analytics of its own yet.
        }
      }
      // else: k.t < lastPropCandle.openTime — stale/out-of-order frame, ignore.
    } catch {
      // malformed frame — ignore
    }
  }
 
  ws.onerror = () => {
    wsStatus.value = 'error'
  }
 
  ws.onclose = () => {
    wsStatus.value = 'disconnected'
    // Exponential back-off reconnect
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      connectWebSocket()
    }, reconnectDelay)
  }
}

function disconnectWebSocket() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
  stopLiveVolumePolling()
}

// ─── Order book (full depth via diff stream + REST snapshot sync) ─────────────
//
// Binance's partial-depth stream (`@depth20@500ms`) only ever gives you the
// top 20 levels. To get the *entire* book locally, in real time, with minimal
// bandwidth, we follow Binance's official order-book management protocol:
//
//   1. Open the diff-depth stream (`@depth`) and buffer every event.
//   2. Fetch a REST snapshot (`GET /fapi/v1/depth?limit=1000`) — 1000 is the
//      max for USDⓈ-M futures (spot allows up to 5000, but this component
//      talks to fstream.binance.com, i.e. futures).
//   3. Drop buffered events older than the snapshot, find the first event
//      that straddles the snapshot's lastUpdateId, and apply everything
//      from there onward.
//   4. Keep applying subsequent diff events, verifying each one's `pu`
//      (previous final update ID) matches the last applied `u`. Any gap
//      means we've missed an update, so we resync from a fresh snapshot.
//
// The local book is kept in plain (non-reactive) Maps for O(1) updates on a
// high-frequency stream; `bidsRaw` / `asksRaw` are refreshed (sorted arrays)
// after each applied event for the rest of the component to consume exactly
// as before.

interface BookLevel { price: number; qty: number }

const REST_BASE = 'https://fapi.binance.com'
const DEPTH_SNAPSHOT_LIMIT = 1000 // USDⓈ-M futures max for /fapi/v1/depth

const bidsMap = new Map<number, number>()
const asksMap = new Map<number, number>()
const bidsRaw = ref<BookLevel[]>([])
const asksRaw = ref<BookLevel[]>([])

/** Notional (price × qty) must exceed the book's average notional × this to count as "large" */
const largeOrderMultiplier = ref<number>(3)

const depthWsStatus = ref<WsStatus>('connecting')
const depthWsStatusLabel = computed(() => ({
  connecting:   'Connecting…',
  connected:    'Live',
  disconnected: 'Disconnected',
  error:        'Error',
}[depthWsStatus.value]))

let depthWs: WebSocket | null = null
let depthReconnectTimer: ReturnType<typeof setTimeout> | null = null
let depthReconnectDelay = 2_000

let bookSynced = false
let eventBuffer: BinanceDepthMessage[] = []
let lastAppliedFinalId = 0
let snapshotInFlight = false

function applyLevels(map: Map<number, number>, levels: string[][]) {
  for (const lvl of levels) {
    const price = parseFloat(lvl[0])
    const qty = parseFloat(lvl[1])
    if (isNaN(price) || isNaN(qty)) continue
    if (qty === 0) {
      map.delete(price)
    } else {
      map.set(price, qty)
    }
  }
}

/** Rebuild the sorted arrays the rest of the component reads from. */
function refreshBookRefs() {
  bidsRaw.value = Array.from(bidsMap.entries())
    .map(([price, qty]) => ({ price, qty }))
    .sort((a, b) => b.price - a.price) // highest bid first

  asksRaw.value = Array.from(asksMap.entries())
    .map(([price, qty]) => ({ price, qty }))
    .sort((a, b) => a.price - b.price) // lowest ask first
}

async function fetchDepthSnapshot(): Promise<BinanceDepthSnapshot> {
  const url = `${REST_BASE}/fapi/v1/depth?symbol=${props.symbol.toUpperCase()}&limit=${DEPTH_SNAPSHOT_LIMIT}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Depth snapshot request failed: ${res.status}`)
  return res.json()
}

/**
 * Fetches a fresh snapshot and replays any buffered/queued diff events on
 * top of it per Binance's sync protocol. Called on initial connect and
 * whenever a gap is detected in the live diff stream.
 */
async function syncOrderBook() {
  if (snapshotInFlight) return
  snapshotInFlight = true
  bookSynced = false

  try {
    const snapshot = await fetchDepthSnapshot()
    bidsMap.clear()
    asksMap.clear()
    applyLevels(bidsMap, snapshot.bids)
    applyLevels(asksMap, snapshot.asks)

    // Discard buffered events entirely older than the snapshot.
    eventBuffer = eventBuffer.filter(evt => (evt.u ?? 0) > snapshot.lastUpdateId)

    let started = false
    for (const evt of eventBuffer) {
      if (!started) {
        // First applied event must straddle the snapshot's lastUpdateId.
        if ((evt.U ?? 0) <= snapshot.lastUpdateId + 1 && (evt.u ?? 0) >= snapshot.lastUpdateId + 1) {
          started = true
        } else {
          continue
        }
      }
      applyLevels(bidsMap, evt.b)
      applyLevels(asksMap, evt.a)
      lastAppliedFinalId = evt.u ?? lastAppliedFinalId
    }

    if (!started) {
      // No buffered event straddled the snapshot yet (fresh connection) —
      // treat the snapshot itself as the current state and wait for the
      // next live event to continue from lastUpdateId.
      lastAppliedFinalId = snapshot.lastUpdateId
    }

    eventBuffer = []
    bookSynced = true
    depthWsStatus.value = depthWs?.readyState === WebSocket.OPEN ? 'connected' : depthWsStatus.value
    refreshBookRefs()
  } catch (err) {
    console.error('Order book snapshot sync failed, retrying…', err)
    depthWsStatus.value = 'error'
    setTimeout(syncOrderBook, 3_000)
  } finally {
    snapshotInFlight = false
  }
}

function connectDepthWebSocket() {
  if (depthWs) {
    depthWs.onclose = null
    depthWs.close()
  }

  bookSynced = false
  eventBuffer = []

  const streamName = `${props.symbol.toLowerCase()}@depth` // full diff stream, not @depth20
  const url = `wss://fstream.binance.com/ws/${streamName}`

  depthWsStatus.value = 'connecting'
  depthWs = new WebSocket(url)

  depthWs.onopen = () => {
    depthWsStatus.value = 'connected'
    depthReconnectDelay = 2_000
    // Kick off (or re-kick) the REST snapshot now that we're buffering live events.
    syncOrderBook()
  }

  depthWs.onmessage = (event: MessageEvent) => {
    try {
      const msg: BinanceDepthMessage = JSON.parse(event.data as string)
      if (!msg.b || !msg.a) return

      if (!bookSynced) {
        eventBuffer.push(msg)
        return
      }

      // Gap check: this event's `pu` should equal the last update ID we applied.
      if (msg.pu !== undefined && msg.pu !== lastAppliedFinalId) {
        console.warn('Order book gap detected (pu mismatch) — resyncing…')
        eventBuffer = [msg]
        syncOrderBook()
        return
      }

      applyLevels(bidsMap, msg.b)
      applyLevels(asksMap, msg.a)
      lastAppliedFinalId = msg.u ?? lastAppliedFinalId
      refreshBookRefs()
    } catch {
      // malformed frame — ignore
    }
  }

  depthWs.onerror = () => {
    depthWsStatus.value = 'error'
  }

  depthWs.onclose = () => {
    depthWsStatus.value = 'disconnected'
    bookSynced = false
    depthReconnectTimer = setTimeout(() => {
      depthReconnectDelay = Math.min(depthReconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      connectDepthWebSocket()
    }, depthReconnectDelay)
  }
}

function disconnectDepthWebSocket() {
  if (depthReconnectTimer !== null) {
    clearTimeout(depthReconnectTimer)
    depthReconnectTimer = null
  }
  if (depthWs) {
    depthWs.onclose = null
    depthWs.close()
    depthWs = null
  }
  bookSynced = false
  eventBuffer = []
  bidsMap.clear()
  asksMap.clear()
  bidsRaw.value = []
  asksRaw.value = []
}

/** Highest-priced bid among those flagged "large" — the nearest big buy wall to mid. */
const largestBidWall = computed<BookLevel | null>(() => {
  if (bidsRaw.value.length === 0) return null
  const avgNotional = bidsRaw.value.reduce((s, l) => s + l.price * l.qty, 0) / bidsRaw.value.length
  if (avgNotional <= 0) return null
  const large = bidsRaw.value.filter(l => l.price * l.qty > avgNotional * largeOrderMultiplier.value)
  if (large.length === 0) return null
  return large.reduce((best, l) => (l.price > best.price ? l : best))
})

/** Lowest-priced ask among those flagged "large" — the nearest big sell wall to mid. */
const lowestAskWall = computed<BookLevel | null>(() => {
  if (asksRaw.value.length === 0) return null
  const avgNotional = asksRaw.value.reduce((s, l) => s + l.price * l.qty, 0) / asksRaw.value.length
  if (avgNotional <= 0) return null
  const large = asksRaw.value.filter(l => l.price * l.qty > avgNotional * largeOrderMultiplier.value)
  if (large.length === 0) return null
  return large.reduce((best, l) => (l.price < best.price ? l : best))
})

function intervalToMs(interval: string): number {
  const unit = interval.slice(-1)
  const value = parseInt(interval.slice(0, -1), 10)
  const unitMs: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
  return (isNaN(value) ? 1 : value) * (unitMs[unit] ?? 60_000)
}

// ─── Countdown to current candle close ─────────────────────────────────────
const nowTick = ref(Date.now())
let nowTickTimer: ReturnType<typeof setInterval> | null = null

/** Formats a candle-close countdown as e.g. "4:07" or "0:52". */
function formatCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const candleCloseCountdown = computed(() => {
  const openTime = liveCandle.value?.openTime ?? props.candles[props.candles.length - 1]?.openTime
  if (openTime == null) return null
  const closeTime = openTime + intervalToMs(props.interval)
  return formatCountdown(closeTime - nowTick.value)
})

/** Formats a raw USDT notional as e.g. 1.2k, 3.45M for compact display. */
function formatNotional(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(0)
}

// ─── displayCandles: replace last item with live data when available ──────────
/**
 * Drop-in replacement for `props.candles` across all computeds below.
 * All indices stay the same — only the last candle's OHLC values change.
 */
const displayCandles = computed<CandleEntry[]>(() => {
  const lastReal = props.candles[props.candles.length - 1]
  const isUpdateToLastCandle = !!liveCandle.value && !!lastReal && liveCandle.value.openTime === lastReal.openTime

  const base = (!liveCandle.value || props.candles.length === 0)
    ? props.candles
    : isUpdateToLastCandle
      // Same bar as the last candle — REPLACE it, don't append.
      ? [...props.candles.slice(0, props.candles.length - 1), liveCandle.value]
      // New bar not yet in props.candles — append as an extra candle.
      : [...props.candles, liveCandle.value]

  if (backtestActive.value) {
    return base.slice(0, Math.min(backtestIndex.value + 1, base.length))
  }
  return base
})

// ─── Preview Buy / Sell / Clear ────────────────────────────────────────────────
interface PreviewPosition {
  side: 'LONG' | 'SHORT'
  entryPrice: number
  tpPrice: number
  slPrice: number
  margin: number
}

const PREVIEW_MARGIN_STORAGE_KEY = 'candleVisualizer.previewMargin'

function loadStoredPreviewMargin(): number {
  try {
    const raw = localStorage.getItem(PREVIEW_MARGIN_STORAGE_KEY)
    const parsed = raw !== null ? parseFloat(raw) : NaN
    return isNaN(parsed) ? 5 : parsed
  } catch {
    // localStorage unavailable (e.g. private browsing / SSR) — fall back to default
    return 5
  }
}

const previewMargin = ref<number>(loadStoredPreviewMargin())

watch(previewMargin, (value) => {
  try {
    localStorage.setItem(PREVIEW_MARGIN_STORAGE_KEY, String(value))
  } catch {
    // ignore write failures (e.g. storage full / disabled)
  }
})

const targetTpRoi = ref<number>(2)
const targetSlRoi = ref<number>(2)
/** Leverage applied to `previewMargin` when sizing the order-book impact estimate below. Fill in as needed. */
const previewLoading = ref(false)
const previewError = ref<string | null>(null)
const pendingSide = ref<'LONG' | 'SHORT' | null>(null)
const previewPosition = ref<PreviewPosition | null>(null)


const maxLeverage = computed(() => {
  var s = chocomintoStore.futureSymbols.find(f => f.symbol == props.symbol);
  if(s){
    return s.maxLeverage
  }else{
    return 0
  }
})
/**
 * Runs the shared preview flow for both Buy and Sell.
 * `side` drives the UI/internal side label; `apiSide` is what
 * OrderMakerUtility.calculateTpSl expects ('BUY' | 'SELL').
 */
async function runPreview(side: 'LONG' | 'SHORT', apiSide: 'BUY' | 'SELL') {
  const referenceCandle = displayCandles.value[displayCandles.value.length - 1]
  if (!referenceCandle || referenceCandle.close == null) {
    previewError.value = 'No live candle to preview against yet.'
    return
  }

  previewError.value = null
  previewLoading.value = true
  pendingSide.value = side

  try {
    const tpSl = await OrderMakerUtility.calculateTpSl(
      previewMargin.value,
      props.symbol,
      apiSide,
      referenceCandle.close.toString(),
      targetTpRoi.value,
      targetSlRoi.value
    )

    previewPosition.value = {
      side,
      entryPrice: referenceCandle.close,
      tpPrice: tpSl.tp_price,
      slPrice: tpSl.sl_price,
      margin: previewMargin.value,
    }
  } catch (error) {
    console.error('Preview TP/SL calculation failed:', error)
    previewError.value = 'Failed to calculate TP/SL. Please try again.'
  } finally {
    previewLoading.value = false
    pendingSide.value = null
  }
}

const previewBuy = () => runPreview('LONG', 'BUY')
const previewSell = () => runPreview('SHORT', 'SELL')

const clearPreview = () => {
  previewPosition.value = null
  previewError.value = null
}

/**
 * Reward:Risk ratio of the current preview position — distance to TP over
 * distance to SL, from entry. Null when there's no preview to measure.
 */
const previewRR = computed<number | null>(() => {
  const pos = previewPosition.value
  if (!pos) return null
  const reward = Math.abs(pos.tpPrice - pos.entryPrice)
  const risk = Math.abs(pos.entryPrice - pos.slPrice)
  if (risk === 0) return null
  return reward / risk
})

const placingOrder = ref(false)

// ─── Pre-trade checklist modal ─────────────────────────────────────────────
//
// "Place Order" no longer fires the order directly — it opens this checklist
// first. It's a manual discretionary checklist (the trader ticks each box
// themselves before confirming); the AVWAP-related items are pre-filled from
// `crossedAvwapPoint` as a starting hint, but every box stays editable.
interface OrderChecklistState {
  buy: {
    nearEma200: boolean
    avwapBreakUp: boolean
    avwapCrossBear: boolean
    higherTfBelow: boolean
  }
  sell: {
    nearEma200: boolean
    avwapBreakDown: boolean
    avwapCrossBull: boolean
    higherTfAbove: boolean
  }
}

function blankOrderChecklist(): OrderChecklistState {
  return {
    buy: { nearEma200: false, avwapBreakUp: false, avwapCrossBear: false, higherTfBelow: false },
    sell: { nearEma200: false, avwapBreakDown: false, avwapCrossBull: false, higherTfAbove: false },
  }
}

const showOrderChecklist = ref(false)
const orderChecklistPos = ref({ x: 140, y: 90 })
const orderChecklist = ref<OrderChecklistState>(blankOrderChecklist())

/**
 * Opens the checklist fresh (no ticks carried over from a previous order)
 * and pre-fills the two AVWAP checkboxes from `crossedAvwapPoint`, if one
 * was passed in. Positions the modal near the top-left of whatever part of
 * the chart is currently scrolled into view, since the SVG (and everything
 * in it) scrolls horizontally with the chart.
 */
function openOrderChecklist() {
  const checklist = blankOrderChecklist()
  const avwap = props.crossedAvwapPoint
  if (avwap) {
    checklist.buy.avwapBreakUp = avwap.direction === 'up'
    checklist.buy.avwapCrossBear = avwap.side === 'bear'
    checklist.sell.avwapBreakDown = avwap.direction === 'down'
    checklist.sell.avwapCrossBull = avwap.side === 'bull'
  }
  orderChecklist.value = checklist

  const scrollLeft = chartContainer.value?.scrollLeft || 0
  orderChecklistPos.value = { x: scrollLeft + 140, y: 90 }
  showOrderChecklist.value = true
}

function cancelOrderChecklist() {
  showOrderChecklist.value = false
}

/** Confirms the checklist and fires the real order — the checklist itself never blocks placing the order, it's a discretionary aid, not a gate. */
async function confirmOrderChecklist() {
  showOrderChecklist.value = false
  await placeOrder()
}

/** Drags the checklist modal by its header, same freeform client-delta approach as the rectangle/backtest move handles. */
function startOrderChecklistDrag(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const startClientX = event.clientX
  const startClientY = event.clientY
  const startX = orderChecklistPos.value.x
  const startY = orderChecklistPos.value.y

  const handleMove = (moveEvent: MouseEvent) => {
    orderChecklistPos.value = {
      x: startX + (moveEvent.clientX - startClientX),
      y: startY + (moveEvent.clientY - startClientY),
    }
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/**
 * Places the previewed position via OrderMakerUtility. Warns (but does not
 * block) when the reward:risk ratio is gambling-tier, i.e. the SL distance
 * is bigger than the TP distance.
 */
async function placeOrder() {
  const pos = previewPosition.value
  if (!pos || !props.symbol) return

  const rr = previewRR.value
  if (rr === null || rr < 1) {
    useNotificationStore().showNotification(
      'warning',
      'top-right',
      'Bad RR',
      'Do not take the position if RR is gambling. TP should be bigger than SL.'
    )
    return
  }

  placingOrder.value = true
  try {
    const apiSide = pos.side === 'LONG' ? 'BUY' : 'SELL'
    await OrderMakerUtility.openOrder(props.symbol!, pos.margin, apiSide, pos.tpPrice, pos.slPrice)
    useNotificationStore().showNotification('success', 'top-right', 'Order', pos.side + ' Order Created')
  } catch (error) {
    console.error('Failed to place order:', error)
    previewError.value = 'Failed to place order. Please try again.'
  } finally {
    placingOrder.value = false
  }
}

/**
 * Drag the preview position's TP or SL line vertically to manually adjust
 * the price. Same vertical-shift math as the backtest position handles
 * (backtestPriceShift), just applied to previewPosition instead of a
 * specific backtest position id — there's only ever one preview at a time.
 */
function startPreviewTpDrag(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const pos = previewPosition.value
  if (!pos) return
  const startY = event.clientY
  const startTp = pos.tpPrice

  const handleMove = (moveEvent: MouseEvent) => {
    if (!previewPosition.value) return
    previewPosition.value.tpPrice = startTp + backtestPriceShift(startY, moveEvent.clientY)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

function startPreviewSlDrag(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const pos = previewPosition.value
  if (!pos) return
  const startY = event.clientY
  const startSl = pos.slPrice

  const handleMove = (moveEvent: MouseEvent) => {
    if (!previewPosition.value) return
    previewPosition.value.slPrice = startSl + backtestPriceShift(startY, moveEvent.clientY)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

// ─── Order-book impact estimate (real-time, walks bidsRaw/asksRaw) ────────────
/** Notional (quote asset) of the previewed order: margin × leverage. */
const orderNotional = computed(() => (previewMargin.value || 0) * (maxLeverage.value || 1))

interface BookWalkResult {
  /** Volume-weighted average price you'd actually fill at, consuming levels top-down. */
  vwapPrice: number
  /** vwapPrice - topOfBookPrice. Positive = price moved against a buyer; for shorts this is negative (you receive less). */
  priceChange: number
  priceChangePercent: number
  /** Whether the book had enough resting size to fully fill the requested notional. */
  fullyFilled: boolean
}

/**
 * Walks a sorted list of book levels (asks ascending for a buy, bids descending
 * for a sell) accumulating notional until `targetNotional` is filled, returning
 * the volume-weighted average fill price and how far it has moved from the
 * best (top-of-book) price.
 */
function walkBook(levels: BookLevel[], targetNotional: number, topPrice: number): BookWalkResult | null {
  if (!levels.length || !topPrice || targetNotional <= 0) return null

  let remainingNotional = targetNotional
  let filledQty = 0
  let filledNotional = 0

  for (const lvl of levels) {
    if (remainingNotional <= 0) break
    const levelNotional = lvl.price * lvl.qty
    const takeNotional = Math.min(remainingNotional, levelNotional)
    filledQty += takeNotional / lvl.price
    filledNotional += takeNotional
    remainingNotional -= takeNotional
  }

  if (filledQty <= 0) return null

  const vwapPrice = filledNotional / filledQty
  const priceChange = vwapPrice - topPrice

  return {
    vwapPrice,
    priceChange,
    priceChangePercent: (priceChange / topPrice) * 100,
    fullyFilled: remainingNotional <= 0,
  }
}

/**
 * Real-time estimated price impact of consuming the book right now for the
 * current preview order size (margin × leverage): `long` walks the asks
 * (what you'd pay going long), `short` walks the bids (what you'd receive
 * going short). Recomputes automatically as the live depth stream updates.
 */
const bookImpact = computed(() => {
  const notional = orderNotional.value
  const bestAsk = asksRaw.value[0]?.price
  const bestBid = bidsRaw.value[0]?.price

  return {
    long: bestAsk ? walkBook(asksRaw.value, notional, bestAsk) : null,
    short: bestBid ? walkBook(bidsRaw.value, notional, bestBid) : null,
  }
})

/**
 * TP/SL boxes for the active preview, drawn the same way as `tpSlBoxes`
 * but anchored to the right edge of the chart (no historical span since
 * this hasn't been placed as a real position yet).
 */
const previewTpSlBoxes = computed(() => {
  if (!previewPosition.value) return []

  const pos = previewPosition.value
  const isLong = pos.side === 'LONG'
  const startIndex = displayCandles.value.length - 1
  const boxLeftX = candleX(startIndex) - candleWidth.value / 2
  const boxRightX = svgWidth.value
  const boxWidth = boxRightX - boxLeftX

  const boxes = []

  const tpUpper = isLong ? pos.tpPrice : pos.entryPrice
  const tpLower = isLong ? pos.entryPrice : pos.tpPrice
  boxes.push({
    x: boxLeftX,
    y: priceToY(tpUpper),
    width: boxWidth,
    height: priceToY(tpLower) - priceToY(tpUpper),
    type: 'tp',
  })

  const slUpper = isLong ? pos.entryPrice : pos.slPrice
  const slLower = isLong ? pos.slPrice : pos.entryPrice
  boxes.push({
    x: boxLeftX,
    y: priceToY(slUpper),
    width: boxWidth,
    height: priceToY(slLower) - priceToY(slUpper),
    type: 'sl',
  })

  return boxes
})

/**
 * On load, auto-anchor a VWAP at the most recent candle flagged
 * `candleData.isAvwapPoint` (a marker set upstream), so the chart opens
 * with that anchored VWAP already plotted instead of requiring a manual
 * click. Open-ended (`endIndex: null`), same as a manual placement.
 */
function plotInitialAvwapPoint() {
  const candles = props.candles
  const avwapPoints = candles.filter(c => c.candleData && c.candleData.isAvwapPoint)
  if (avwapPoints.length > 0) {
    const lastAvwapPoint = avwapPoints[avwapPoints.length - 1]
    const index = candles.indexOf(lastAvwapPoint)
    if (index !== -1) {
      anchoredVwaps.value.push({ id: ++avwapIdCounter, anchorIndex: index, endIndex: null })
    }
  }
}

// Manually-anchored VWAPs are indices into the *current* candle array, so
// they're meaningless (and can silently point at some unrelated candle) once
// the candle data changes out from under them — e.g. switching symbols.
// Watch `props.candles` directly (not symbol/interval) so this only fires
// once the new dataset has actually arrived, avoiding a stale-index race if
// the parent updates candles a tick after the symbol prop.
watch(() => props.candles, () => {
  anchoredVwaps.value = []
  plotInitialAvwapPoint()
})

// The kline/depth WebSocket streams are keyed by symbol+interval at connect
// time and never re-subscribe on their own. Without this watcher, switching
// symbols (or interval) leaves the socket bound to the OLD market while
// props.candles moves on to the new one — the live candle then keeps getting
// patched with another symbol's OHLCV (volume included), which is what was
// blowing up the live volume bar and skewing the AVWAP mid (its cumVol sum
// gets one wildly-mis-scaled point). Also null out liveCandle immediately so
// displayCandles doesn't append that stale/mismatched candle while we wait
// for the new stream's first message.
watch(() => [props.symbol, props.interval], () => {
  liveCandle.value = null
  liveVolume.value = null
  disconnectWebSocket()
  connectWebSocket()
  disconnectDepthWebSocket()
  connectDepthWebSocket()
})

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/** Closes the "Fill PZ AVWAP" dropdown when clicking anywhere outside it. */
function handlePzAvwapDropdownOutsideClick(event: MouseEvent) {
  if (!pzAvwapDropdownOpen.value) return
  if (pzAvwapDropdownRef.value && !pzAvwapDropdownRef.value.contains(event.target as Node)) {
    pzAvwapDropdownOpen.value = false
  }
}

onMounted(() => {
  scrollToRight()
  connectWebSocket()
  connectDepthWebSocket()
  plotInitialAvwapPoint()
  if (showCrossTfEma.value) fetchCrossTfEma()
  tryShowCachedMovement()
  nowTickTimer = setInterval(() => { nowTick.value = Date.now() }, 1_000)
  document.addEventListener('mousedown', handlePzAvwapDropdownOutsideClick)
  restoreDrawingsWhenReady(props.symbol)
})

// Re-load this symbol's saved rectangles/lines (and drop the previous
// symbol's) whenever the chart is pointed at a different pair — same
// per-symbol scoping as the rest of the persisted drawing state.
watch(() => props.symbol, (symbol) => {
  restoreDrawingsWhenReady(symbol)
})

onUnmounted(() => {
  disconnectWebSocket()
  disconnectDepthWebSocket()
  if (nowTickTimer !== null) {
    clearInterval(nowTickTimer)
    nowTickTimer = null
  }
  document.removeEventListener('mousedown', handlePzAvwapDropdownOutsideClick)
})

// ─── Existing computed / helpers (unchanged, but now use displayCandles) ──────

const selectedCandle = computed(() => {
  return selectedCandleIndex.value !== null ? displayCandles.value[selectedCandleIndex.value] : null
})

const otherProps = computed(() => {
  if (!selectedCandle.value) return {}
  const excluded = ['open', 'high', 'low', 'close', 'priceZone', 'tpPrice', 'slPrice', 'side', 'candleData', 'status']
  const others: Record<string, any> = {}
  for (const [key, value] of Object.entries(selectedCandle.value)) {
    if (!excluded.includes(key) && value !== undefined && value !== null) {
      others[key] = value
    }
  }
  return others
})

const minPrice = computed(() => {
  if (priceRangeMin.value !== 0) return priceRangeMin.value
  // Multi-TF bars are aggregated directly from displayCandles, so their
  // highs/lows are always a subset of the base range already covered here.
  return Math.min(...displayCandles.value.map(c => c.low!)) * 0.98
})

const maxPrice = computed(() => {
  if (priceRangeMax.value !== 0) return priceRangeMax.value
  return Math.max(...displayCandles.value.map(c => c.high!)) * 1.02
})

const priceDelta = computed(() => maxPrice.value - minPrice.value)

const svgWidth = computed(() => {
  return (displayCandles.value.length + multiTfPrependOffsetSlots.value) * (candleWidth.value + candleGap) + 200
})

const gridPrices = computed(() => {
  const range = maxPrice.value - minPrice.value
  const step = range / 8
  return Array.from({ length: 9 }, (_, i) => minPrice.value + step * i)
})

const scrollToRight = () => {
  if (chartContainer.value) {
    nextTick(() => {
      chartContainer.value!.scrollLeft = chartContainer.value!.scrollWidth
    })
  }
}

const zoneRectangles = computed(() => {
  const rects = []
  let currentZone = null
  let zoneStartIndex = 0

  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.priceZone && (!currentZone || JSON.stringify(currentZone) !== JSON.stringify(candle.priceZone))) {
      if (currentZone) {
        rects.push({
          x: candleX(zoneStartIndex) - candleWidth.value / 2,
          y: priceToY(currentZone.upper!),
          width: candleX(i - 1) + candleWidth.value / 2 - (candleX(zoneStartIndex) - candleWidth.value / 2),
          height: priceToY(currentZone.lower!) - priceToY(currentZone.upper!),
          isActive: false,
        })
      }
      currentZone = candle.priceZone
      zoneStartIndex = i
    }
  }

  if (currentZone) {
    const zoneEndIndex = Math.min(zoneStartIndex + CANDLES_PER_ZONE - 1, displayCandles.value.length - 1)
    const endX = candleX(zoneEndIndex) + candleWidth.value / 2
    rects.push({
      x: candleX(zoneStartIndex) - candleWidth.value / 2,
      y: priceToY(currentZone.upper!),
      width: endX - (candleX(zoneStartIndex) - candleWidth.value / 2),
      height: priceToY(currentZone.lower!) - priceToY(currentZone.upper!),
      isActive: true,
    })
  }

  return rects
})

const zoneMidLines = computed(() => {
  const lines = []
  let currentZone = null
  let zoneStartIndex = 0

  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.priceZone && (!currentZone || JSON.stringify(currentZone) !== JSON.stringify(candle.priceZone))) {
      if (currentZone) {
        lines.push({
          x1: candleX(zoneStartIndex) - candleWidth.value / 2,
          x2: candleX(i - 1) + candleWidth.value / 2,
          y: priceToY(currentZone.mid!),
        })
      }
      currentZone = candle.priceZone
      zoneStartIndex = i
    }
  }

  if (currentZone) {
    const zoneEndIndex = Math.min(zoneStartIndex + CANDLES_PER_ZONE - 1, displayCandles.value.length - 1)
    lines.push({
      x1: candleX(zoneStartIndex) - candleWidth.value / 2,
      x2: candleX(zoneEndIndex) + candleWidth.value / 2,
      y: priceToY(currentZone.mid!),
    })
  }

  return lines
})

const supportResistanceLines = computed(() => {
  const lines: any[] = []

  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]

    if (candle.breakthrough_support && candle.support?.lower) {
      const startIndex = Math.max(0, i - SR_SPAN)
      const endIndex = Math.min(displayCandles.value.length - 1, i + SR_SPAN)
      lines.push({ x1: candleX(startIndex) - candleWidth.value / 2, x2: candleX(endIndex) + candleWidth.value / 2, y: priceToY(candle.support.lower), type: 'breakthrough_support' })
    }

    if (candle.breakthrough_resistance && candle.resistance?.upper) {
      const startIndex = Math.max(0, i - SR_SPAN)
      const endIndex = Math.min(displayCandles.value.length - 1, i + SR_SPAN)
      lines.push({ x1: candleX(startIndex) - candleWidth.value / 2, x2: candleX(endIndex) + candleWidth.value / 2, y: priceToY(candle.resistance.upper), type: 'breakthrough_resistance' })
    }
  }

  if (hoveredCandleIndex.value !== null) {
    const candleIndex = hoveredCandleIndex.value
    const candle = displayCandles.value[candleIndex]

    if (candle.support || candle.resistance) {
      const startIndex = Math.max(0, candleIndex - SR_SPAN)
      const endIndex = Math.min(displayCandles.value.length - 1, candleIndex + SR_SPAN)
      const x1 = candleX(startIndex) - candleWidth.value / 2
      const x2 = candleX(endIndex) + candleWidth.value / 2

      if (candle.support?.lower) lines.push({ x1, x2, y: priceToY(candle.support.lower), type: 'support' })
      if (candle.resistance?.upper) lines.push({ x1, x2, y: priceToY(candle.resistance.upper), type: 'resistance' })
    }
  }

  return lines
})

const zoneLabels = computed(() => {
  const labels = []
  let currentZone = null
  let zoneStartIndex = 0
  var currentSize = 0

  for (let i = 0; i <= displayCandles.value.length - 1; i++) {
    const candle = displayCandles.value[i]
    if (candle.priceZone && (!currentZone || JSON.stringify(currentZone) !== JSON.stringify(candle.priceZone))) {
      if (currentZone) {
        currentSize = displayCandles.value[i - 1].candleData!.zoneSizePercentage!
        const midX = (candleX(zoneStartIndex) + candleX(i - 1)) / 2
        labels.push({ x: midX, y: priceToY(currentZone.upper!) - 15, text: `${currentSize.toFixed(2)}% | ${displayCandles.value[i - 1].candleData!.extraInfo}` })
      }
      currentZone = candle.priceZone
      zoneStartIndex = i
    }
  }

  if (currentZone) {
    const midX = (candleX(zoneStartIndex) + candleX(displayCandles.value.length - 1)) / 2
    currentSize = displayCandles.value[displayCandles.value.length - 1].candleData!.zoneSizePercentage!
    labels.push({ x: midX, y: priceToY(currentZone.upper!) - 15, text: `${currentSize.toFixed(2)}%` })
  }

  return labels
})

const emaPoints = computed(() => {
  const points: string[] = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    const ema9 = displayCandles.value[i].candleData?.ema200
    if (ema9 !== undefined && ema9 !== null) {
      points.push(`${candleX(i)},${priceToY(ema9)}`)
    }
  }
  return points.join(' ')
})

/** MA200 line points — plotted orange when "Show MA" is enabled. */
const ma200Points = computed(() => {
  const points: string[] = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    const ma200 = displayCandles.value[i].candleData?.ma200
    if (ma200 !== undefined && ma200 !== null) {
      points.push(`${candleX(i)},${priceToY(ma200)}`)
    }
  }
  return points.join(' ')
})

/** MA100 line points — plotted blue when "Show MA" is enabled. */
const ma100Points = computed(() => {
  const points: string[] = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    const ma100 = displayCandles.value[i].candleData?.ma100
    if (ma100 !== undefined && ma100 !== null) {
      points.push(`${candleX(i)},${priceToY(ma100)}`)
    }
  }
  return points.join(' ')
})

// ─── Cross-timeframe EMA200 overlay ────────────────────────────────────────
//
// Plots the 200-period EMA computed on the 1h / 4h / 1d candles directly
// onto the chart, independent of whatever interval the chart itself is
// showing. Each higher timeframe is fetched on its own (limit 500, same as
// the other REST calls in this file), EMA200 is computed locally from those
// closes, and the result is then stepped onto the displayed candles the
// same way OI history is: for each displayed candle, use the most recent
// higher-TF EMA200 value at or before that candle's close time.
interface CrossTfEmaPoint {
  closeTime: number
  ema: number
}

const CROSS_TF_EMA_TIMEFRAMES = ['1h', '4h', '1d'] as const
type CrossTfEmaTimeframe = typeof CROSS_TF_EMA_TIMEFRAMES[number]

const CROSS_TF_EMA_PERIOD = 200
const CROSS_TF_EMA_LIMIT = 1000

const CROSS_TF_EMA_COLORS: Record<CrossTfEmaTimeframe, string> = {
  '1h': '#42a5f5',
  '4h': '#ab47bc',
  '1d': '#ffd54f',
}

const CROSS_TF_EMA_LABELS: Record<CrossTfEmaTimeframe, string> = {
  '1h': '1H EMA200',
  '4h': '4H EMA200',
  '1d': '1D EMA200',
}

const showCrossTfEma = ref(true)
const crossTfEmaSeries = ref<Record<CrossTfEmaTimeframe, CrossTfEmaPoint[]>>({
  '1h': [],
  '4h': [],
  '1d': [],
})
const crossTfEmaLoading = ref(false)
const crossTfEmaError = ref<string | null>(null)

/**
 * Standard EMA200: seeded with an SMA of the first 200 closes, then EMA'd
 * forward from there. Returns one value per input candle — null wherever
 * fewer than 200 closes have accumulated yet.
 */
function calculateEma200Series(closes: number[]): (number | null)[] {
  const period = CROSS_TF_EMA_PERIOD
  const result: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period) return result

  const k = 2 / (period + 1)
  let sma = 0
  for (let i = 0; i < period; i++) sma += closes[i]
  sma /= period
  result[period - 1] = sma

  let prevEma = sma
  for (let i = period; i < closes.length; i++) {
    const ema = closes[i] * k + prevEma * (1 - k)
    result[i] = ema
    prevEma = ema
  }
  return result
}

async function fetchCrossTfEmaForTimeframe(tf: CrossTfEmaTimeframe): Promise<CrossTfEmaPoint[]> {
  const url = `${REST_BASE}/fapi/v1/klines?symbol=${props.symbol.toUpperCase()}&interval=${tf}&limit=${CROSS_TF_EMA_LIMIT}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`request failed (${res.status})`)
  const data = await res.json()
  if (!Array.isArray(data)) return []

  const closes = data.map((k: any[]) => parseFloat(k[4]))
  const emaValues = calculateEma200Series(closes)

  const points: CrossTfEmaPoint[] = []
  for (let i = 0; i < data.length; i++) {
    const ema = emaValues[i]
    if (ema == null) continue
    points.push({ closeTime: Number(data[i][6]), ema })
  }
  return points
}

async function fetchCrossTfEma() {
  if (!props.symbol) return
  crossTfEmaLoading.value = true
  crossTfEmaError.value = null
  try {
    const results = await Promise.all(CROSS_TF_EMA_TIMEFRAMES.map(fetchCrossTfEmaForTimeframe))
    const next = { '1h': [], '4h': [], '1d': [] } as Record<CrossTfEmaTimeframe, CrossTfEmaPoint[]>
    CROSS_TF_EMA_TIMEFRAMES.forEach((tf, i) => { next[tf] = results[i] })
    crossTfEmaSeries.value = next
  } catch (err) {
    crossTfEmaError.value = err instanceof Error ? err.message : 'failed to load cross-TF EMA'
    crossTfEmaSeries.value = { '1h': [], '4h': [], '1d': [] }
  } finally {
    crossTfEmaLoading.value = false
  }
}

// Fetch the first time the checkbox is turned on, and whenever the symbol
// changes while it's already on (stale EMA series for a different pair
// would otherwise just sit there silently, same reasoning as fetchOiHistory).
watch(showCrossTfEma, (active) => {
  if (active) fetchCrossTfEma()
})
watch(() => props.symbol, () => {
  if (showCrossTfEma.value) fetchCrossTfEma()
})

/**
 * Steps a higher-timeframe EMA200 series onto the displayed candles: for
 * each displayed candle, the most recent higher-TF EMA200 value at or
 * before that candle's close time. Same forward-only-pointer technique as
 * `oiPerCandle`.
 */
function crossTfEmaPerCandle(tf: CrossTfEmaTimeframe): (number | null)[] {
  const series = crossTfEmaSeries.value[tf]
  if (series.length === 0) return displayCandles.value.map(() => null)

  const intervalMs = intervalToMs(props.interval)
  let sIdx = 0

  return displayCandles.value.map(candle => {
    if (candle.openTime == null) return null
    const cutoff = candle.openTime + intervalMs
    while (sIdx + 1 < series.length && series[sIdx + 1].closeTime <= cutoff) sIdx++
    return series[sIdx].closeTime <= cutoff ? series[sIdx].ema : null
  })
}

/** Polyline points plus the right-hand label position, per cross-TF EMA line. */
const crossTfEmaLines = computed(() => {
  return CROSS_TF_EMA_TIMEFRAMES.map(tf => {
    const values = crossTfEmaPerCandle(tf)
    const points: string[] = []
    let lastX = 0
    let lastY = 0
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (v == null) continue
      lastX = candleX(i)
      lastY = priceToY(v)
      points.push(`${lastX},${lastY}`)
    }
    return {
      tf,
      color: CROSS_TF_EMA_COLORS[tf],
      label: CROSS_TF_EMA_LABELS[tf],
      points: points.join(' '),
      labelX: lastX + candleWidth.value + 8,
      labelY: lastY + 4,
      hasPoints: points.length > 0,
    }
  })
})

// ─── Multi-TF candle overlay (1H/4H/1D) ────────────────────────────────────
// Renders higher-timeframe candles faded behind the base chart, using the
// same per-timeframe colors as the cross-TF EMA lines so the two overlays
// read as one consistent "higher timeframe" language: bull = solid color,
// bear = a lighter tint of that same color.

interface MultiTfCandlePoint {
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
}

const MULTI_TF_CANDLE_TIMEFRAMES = ['1h', '4h', '1d'] as const
type MultiTfCandleTimeframe = typeof MULTI_TF_CANDLE_TIMEFRAMES[number]
const MULTI_TF_CANDLE_LIMIT = 500

const MULTI_TF_CANDLE_COLORS: Record<MultiTfCandleTimeframe, string> = CROSS_TF_EMA_COLORS

/** Mixes a hex color toward white by `amount` (0-1) to get a "lighter" bear shade. */
function lightenHexColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '')
  const num = parseInt(clean, 16)
  const r = Math.round(((num >> 16) & 0xff) + (255 - ((num >> 16) & 0xff)) * amount)
  const g = Math.round(((num >> 8) & 0xff) + (255 - ((num >> 8) & 0xff)) * amount)
  const b = Math.round((num & 0xff) + (255 - (num & 0xff)) * amount)
  return `rgb(${r}, ${g}, ${b})`
}

const MULTI_TF_CANDLE_LIGHT_COLORS: Record<MultiTfCandleTimeframe, string> = {
  '1h': lightenHexColor(CROSS_TF_EMA_COLORS['1h'], 0.55),
  '4h': lightenHexColor(CROSS_TF_EMA_COLORS['4h'], 0.55),
  '1d': lightenHexColor(CROSS_TF_EMA_COLORS['1d'], 0.55),
}

const showMultiTf1h = ref(false)
const showMultiTf4h = ref(false)
const showMultiTf1d = ref(false)

const MULTI_TF_CANDLE_ACTIVE_REFS: Record<MultiTfCandleTimeframe, Ref<boolean>> = {
  '1h': showMultiTf1h,
  '4h': showMultiTf4h,
  '1d': showMultiTf1d,
}

function isMultiTfCandleActive(tf: MultiTfCandleTimeframe): boolean {
  return MULTI_TF_CANDLE_ACTIVE_REFS[tf].value
}

const multiTfCandleSeries = ref<Record<MultiTfCandleTimeframe, MultiTfCandlePoint[]>>({
  '1h': [],
  '4h': [],
  '1d': [],
})
const multiTfCandleLoading = ref<Record<MultiTfCandleTimeframe, boolean>>({ '1h': false, '4h': false, '1d': false })
const multiTfCandleError = ref<Record<MultiTfCandleTimeframe, string | null>>({ '1h': null, '4h': null, '1d': null })

async function fetchMultiTfCandlesForTimeframe(tf: MultiTfCandleTimeframe): Promise<MultiTfCandlePoint[]> {
  const url = `${REST_BASE}/fapi/v1/klines?symbol=${props.symbol.toUpperCase()}&interval=${tf}&limit=${MULTI_TF_CANDLE_LIMIT}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`request failed (${res.status})`)
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return data.map((k: any[]) => ({
    openTime: Number(k[0]),
    closeTime: Number(k[6]),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }))
}

/** Fetches (or re-fetches) a single timeframe's candles, independent of the other two checkboxes. */
async function fetchMultiTfCandles(tf: MultiTfCandleTimeframe) {
  if (!props.symbol) return
  multiTfCandleLoading.value = { ...multiTfCandleLoading.value, [tf]: true }
  multiTfCandleError.value = { ...multiTfCandleError.value, [tf]: null }
  try {
    const points = await fetchMultiTfCandlesForTimeframe(tf)
    multiTfCandleSeries.value = { ...multiTfCandleSeries.value, [tf]: points }
  } catch (err) {
    multiTfCandleError.value = { ...multiTfCandleError.value, [tf]: err instanceof Error ? err.message : 'failed to load candles' }
    multiTfCandleSeries.value = { ...multiTfCandleSeries.value, [tf]: [] }
  } finally {
    multiTfCandleLoading.value = { ...multiTfCandleLoading.value, [tf]: false }
  }
}

// Each checkbox fetches its own timeframe independently the first time it's
// turned on, and whenever the symbol changes while it's already on.
watch(showMultiTf1h, (active) => { if (active) fetchMultiTfCandles('1h') })
watch(showMultiTf4h, (active) => { if (active) fetchMultiTfCandles('4h') })
watch(showMultiTf1d, (active) => { if (active) fetchMultiTfCandles('1d') })
watch(() => props.symbol, () => {
  MULTI_TF_CANDLE_TIMEFRAMES.forEach(tf => {
    if (isMultiTfCandleActive(tf)) fetchMultiTfCandles(tf)
  })
})

/**
 * Groups the displayed (base-timeframe) candles into contiguous index spans
 * that fall under the same higher-timeframe candle, and pairs each span with
 * that higher-TF candle's OHLC. One rendered bar = one higher-TF candle,
 * drawn as wide as the base candles it covers.
 */
/**
 * Groups the displayed (base-timeframe) candles into contiguous index spans
 * that fall under the same higher-timeframe period. OHLC is deliberately
 * NOT carried here anymore — it's recomputed from the base candles at
 * render time (see aggregateBaseCandlesOhlc), so that dragging a bar's
 * right edge backward can recompute a "partially formed" OHLC instead of
 * always showing the fully-closed higher-TF candle.
 */
function multiTfCandleBars(tf: MultiTfCandleTimeframe) {
  const series = multiTfCandleSeries.value[tf]
  const candles = displayCandles.value
  const bars: Array<{ startIndex: number; endIndex: number }> = []
  if (series.length === 0 || candles.length === 0) return bars

  let sIdx = 0
  let bucketStart = -1
  let bucketSeriesIdx = -1

  for (let i = 0; i < candles.length; i++) {
    const openTime = candles[i].openTime
    if (openTime == null) continue
    while (sIdx + 1 < series.length && series[sIdx + 1].openTime <= openTime) sIdx++
    if (openTime < series[sIdx].openTime) continue // before any fetched higher-TF data

    if (sIdx !== bucketSeriesIdx) {
      if (bucketSeriesIdx !== -1) {
        bars.push({ startIndex: bucketStart, endIndex: i - 1 })
      }
      bucketSeriesIdx = sIdx
      bucketStart = i
    }
  }
  if (bucketSeriesIdx !== -1) {
    bars.push({ startIndex: bucketStart, endIndex: candles.length - 1 })
  }
  return bars
}

const multiTfCandleBarsByTf = computed(() => {
  const empty = { '1h': [], '4h': [], '1d': [] } as Record<MultiTfCandleTimeframe, ReturnType<typeof multiTfCandleBars>>
  const result = { ...empty }
  MULTI_TF_CANDLE_TIMEFRAMES.forEach(tf => {
    if (isMultiTfCandleActive(tf)) result[tf] = multiTfCandleBars(tf)
  })
  return result
})

/**
 * Aggregates the base-timeframe candles in [startIndex, endIndex] into a
 * single OHLC — open from the first candle, close from the last, high/low
 * across the whole span. Used both for the "full" (natural) higher-TF bar
 * and for a partial/backtest-scrubbed slice of it.
 */
function aggregateBaseCandlesOhlc(startIndex: number, endIndex: number) {
  const candles = displayCandles.value.slice(startIndex, endIndex + 1)
  if (candles.length === 0) return null
  let high = -Infinity
  let low = Infinity
  for (const c of candles) {
    if (c.high != null && c.high > high) high = c.high
    if (c.low != null && c.low < low) low = c.low
  }
  const open = candles[0].open
  const close = candles[candles.length - 1].close
  if (open == null || close == null || !isFinite(high) || !isFinite(low)) return null
  return { open, high, low, close }
}

// Per-bar "scrub back" overrides for backtesting: key is `${tf}-${startIndex}`,
// value is the candle index the user dragged the right edge back to. Absent
// key = show the bar's full, naturally-closed span.
const multiTfBarOverrides = ref<Record<string, number>>({})

const multiTfScrubbedCount = computed(() => Object.keys(multiTfBarOverrides.value).length)

function multiTfBarKey(tf: MultiTfCandleTimeframe, startIndex: number): string {
  return `${tf}-${startIndex}`
}

/** Resets a scrubbed bar back to its full, fully-closed span. */
function resetMultiTfBar(tf: MultiTfCandleTimeframe, startIndex: number) {
  const key = multiTfBarKey(tf, startIndex)
  if (key in multiTfBarOverrides.value) {
    const next = { ...multiTfBarOverrides.value }
    delete next[key]
    multiTfBarOverrides.value = next
  }
}

/**
 * Drag the right edge of a multi-TF bar backward to see what that
 * higher-timeframe candle looked like N base candles earlier — same
 * edge-resize interaction as the Range Download tool, but clamped so it
 * can only pull back toward startIndex, never extend past the bar's
 * natural (fully-closed) endIndex.
 */
function startMultiTfBarResize(tf: MultiTfCandleTimeframe, startIndex: number, naturalEndIndex: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const key = multiTfBarKey(tf, startIndex)

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.max(startIndex, Math.min(naturalEndIndex, Math.round(raw)))
    if (snapped >= naturalEndIndex) {
      resetMultiTfBar(tf, startIndex)
    } else {
      multiTfBarOverrides.value = { ...multiTfBarOverrides.value, [key]: snapped }
    }
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Pixel-space render data for every multi-TF bar across all three timeframes. */
const multiTfCandleRenderBars = computed(() => {
  const out: Array<{
    key: string
    tf: MultiTfCandleTimeframe
    startIndex: number
    naturalEndIndex: number
    effectiveEndIndex: number
    isPartial: boolean
    candleCount: number
    totalCandleCount: number
    x: number
    width: number
    wickX: number
    wickY1: number
    wickY2: number
    bodyY: number
    bodyHeight: number
    handleX: number
    handleTop: number
    handleBottom: number
    isBull: boolean
    color: string
  }> = []

  MULTI_TF_CANDLE_TIMEFRAMES.forEach(tf => {
    multiTfCandleBarsByTf.value[tf].forEach(bar => {
      const key = multiTfBarKey(tf, bar.startIndex)
      const override = multiTfBarOverrides.value[key]
      const effectiveEndIndex = override !== undefined
        ? Math.max(bar.startIndex, Math.min(bar.endIndex, override))
        : bar.endIndex
      const ohlc = aggregateBaseCandlesOhlc(bar.startIndex, effectiveEndIndex)
      if (!ohlc) return

      const x1 = candleX(bar.startIndex) - candleWidth.value / 2
      const x2 = candleX(effectiveEndIndex) + candleWidth.value / 2
      const inset = Math.min(3, (x2 - x1) / 6)
      const isBull = ohlc.close >= ohlc.open
      const openY = priceToY(ohlc.open)
      const closeY = priceToY(ohlc.close)

      out.push({
        key,
        tf,
        startIndex: bar.startIndex,
        naturalEndIndex: bar.endIndex,
        effectiveEndIndex,
        isPartial: effectiveEndIndex < bar.endIndex,
        candleCount: effectiveEndIndex - bar.startIndex + 1,
        totalCandleCount: bar.endIndex - bar.startIndex + 1,
        x: x1 + inset,
        width: Math.max(x2 - x1 - inset * 2, 1),
        wickX: (x1 + x2) / 2,
        wickY1: priceToY(ohlc.high),
        wickY2: priceToY(ohlc.low),
        bodyY: Math.min(openY, closeY),
        bodyHeight: Math.max(Math.abs(closeY - openY), 1),
        handleX: x2,
        handleTop: priceToY(ohlc.high) - 4,
        handleBottom: priceToY(ohlc.low) + 4,
        isBull,
        color: isBull ? MULTI_TF_CANDLE_COLORS[tf] : MULTI_TF_CANDLE_LIGHT_COLORS[tf],
      })
    })
  })
  return out
})

// ─── Multi-TF "lead-in" candles ────────────────────────────────────────────
// Unlike multiTfCandleRenderBars above (which stretches one higher-TF candle
// across however many base candles it overlaps — used for the portion of the
// higher-TF candle that overlaps the currently-loaded base range), these are
// the higher-TF candles that closed BEFORE the very first loaded base candle.
// There's no base candle to stretch across, so instead they're drawn as their
// own single-width bars (same width as a base candle) prepended to the left
// of the chart, oldest → newest, ending right before base index 0:
//   [4h][4h][4h][4h][gap][first base candle][base][base]...
// This gives a quick read on higher-TF structure/levels leading into the
// currently-visible range without guessing from a stretched wrap-candle.
// Every fetched higher-TF candle that closes before the first loaded base
// candle is shown (bounded only by how much history fetchMultiTfCandles
// pulled back — MULTI_TF_CANDLE_LIMIT candles per timeframe), not a fixed
// count — so scrolling further back in time naturally reveals more of them.
const MULTI_TF_PREPEND_LANE_ORDER: MultiTfCandleTimeframe[] = ['1d', '4h', '1h']
const MULTI_TF_PREPEND_LANE_GAP_SLOTS = 1 // empty slot(s) between adjacent lanes

/** Every higher-TF candle (per active tf) that closes before the first loaded base candle, oldest-first. */
const multiTfPrependLaneInfo = computed(() => {
  const base = displayCandles.value
  const lanes: Array<{ tf: MultiTfCandleTimeframe; points: MultiTfCandlePoint[]; startSlot: number }> = []
  if (base.length === 0 || base[0].openTime == null) return { lanes, totalSlots: 0 }

  const earliestOpenTime = base[0].openTime!
  let slotCursor = 0
  MULTI_TF_PREPEND_LANE_ORDER.forEach(tf => {
    if (!isMultiTfCandleActive(tf)) return
    const series = multiTfCandleSeries.value[tf]
    const points = series.filter(p => p.closeTime <= earliestOpenTime)
    if (points.length === 0) return
    lanes.push({ tf, points, startSlot: slotCursor })
    slotCursor += points.length + MULTI_TF_PREPEND_LANE_GAP_SLOTS
  })

  const totalSlots = lanes.length > 0 ? slotCursor - MULTI_TF_PREPEND_LANE_GAP_SLOTS : 0
  return { lanes, totalSlots }
})

/** Extra slot-widths reserved on the left of the chart (1 trailing gap slot before base index 0, only when there's something to prepend). */
const multiTfPrependOffsetSlots = computed(() => {
  const { totalSlots, lanes } = multiTfPrependLaneInfo.value
  return lanes.length > 0 ? totalSlots + 1 : 0
})

/** Pixel-space render data for the prepended higher-TF lead-in candles. */
const multiTfPrependRenderBars = computed(() => {
  const out: Array<{
    key: string
    tf: MultiTfCandleTimeframe
    x: number
    width: number
    wickX: number
    wickY1: number
    wickY2: number
    bodyY: number
    bodyHeight: number
    isBull: boolean
    color: string
    isFirstOfLane: boolean
  }> = []

  const offsetSlots = multiTfPrependOffsetSlots.value

  multiTfPrependLaneInfo.value.lanes.forEach(lane => {
    lane.points.forEach((p, i) => {
      const slot = lane.startSlot + i
      const pseudoIndex = slot - offsetSlots // negative — candleX() re-adds the offset internally
      const isBull = p.close >= p.open
      const openY = priceToY(p.open)
      const closeY = priceToY(p.close)
      const cx = candleX(pseudoIndex)

      out.push({
        key: `prepend-${lane.tf}-${p.openTime}`,
        tf: lane.tf,
        x: cx - candleWidth.value / 2,
        width: candleWidth.value,
        wickX: cx,
        wickY1: priceToY(p.high),
        wickY2: priceToY(p.low),
        bodyY: Math.min(openY, closeY),
        bodyHeight: Math.max(Math.abs(closeY - openY), 1),
        isBull,
        color: isBull ? MULTI_TF_CANDLE_COLORS[lane.tf] : MULTI_TF_CANDLE_LIGHT_COLORS[lane.tf],
        isFirstOfLane: i === 0,
      })
    })
  })

  return out
})

const volumeSpikePoints = computed(() => {
  const points: string[] = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    if (displayCandles.value[i].candleData?.volumeSpike) {
      points.push(`${candleX(i)},${priceToY(displayCandles.value[i].close!)}`)
    }
  }
  return points.join(' ')
})

const volumeSpikeChangeLabels = computed(() => {
  const labels: any[] = []
  const spikeIndices: number[] = []

  for (let i = 0; i < displayCandles.value.length; i++) {
    if (displayCandles.value[i].candleData?.volumeSpike) spikeIndices.push(i)
  }

  for (let i = 0; i < spikeIndices.length - 1; i++) {
    const ci = spikeIndices[i]
    const ni = spikeIndices[i + 1]
    const cp = displayCandles.value[ci].close!
    const np = displayCandles.value[ni].close!
    const pct = ((np - cp) / cp) * 100
    labels.push({
      x: (candleX(ci) + candleX(ni)) / 2,
      y: (priceToY(cp) + priceToY(np)) / 2 - 8,
      text: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
      changePositive: pct >= 0,
    })
  }

  return labels
})

const positions = computed(() => {
  const result = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.tpPrice && candle.slPrice && candle?.side) {
      let endIndex = i
      let endStatus = 'OPEN'
      for (let j = i + 1; j < displayCandles.value.length; j++) {
        const nc = displayCandles.value[j]
        if (nc.status && nc.status.includes('_')) { endIndex = j; endStatus = nc.status; break }
      }
      if (endStatus === 'OPEN') endIndex = displayCandles.value.length - 1
      result.push({ startIndex: i, endIndex, entryPrice: candle.close, tpPrice: candle.tpPrice, slPrice: candle.slPrice, side: candle.side, status: endStatus })
      i = endIndex
    }
  }
  return result
})

const tpSlBoxes = computed(() => {
  const boxes = []
  for (const pos of positions.value) {
    const isLong = pos.side === 'LONG'
    const tpUpper = isLong ? pos.tpPrice : pos.entryPrice
    const tpLower = isLong ? pos.entryPrice : pos.tpPrice
    boxes.push({ x: candleX(pos.startIndex) - candleWidth.value / 2, y: priceToY(tpUpper!), width: candleX(pos.endIndex) - candleX(pos.startIndex) + candleWidth.value, height: priceToY(tpLower!) - priceToY(tpUpper!), type: 'tp', status: pos.status })
    const slUpper = isLong ? pos.entryPrice : pos.slPrice
    const slLower = isLong ? pos.slPrice : pos.entryPrice
    boxes.push({ x: candleX(pos.startIndex) - candleWidth.value / 2, y: priceToY(slUpper!), width: candleX(pos.endIndex) - candleX(pos.startIndex) + candleWidth.value, height: priceToY(slLower!) - priceToY(slUpper!), type: 'sl', status: pos.status })
  }
  return boxes
})

// ─── Indicator panel layout (own stacked sections below the price chart) ──────
//
// Volume / OI / Long-Short used to be drawn as semi-transparent overlays on
// top of the last ~100–230px of the price chart itself, which meant tall
// wicks or a strong trend leg could visually collide with the bars sitting
// "inside" the candle area. This computed lays out each active panel as its
// own dedicated band stacked BELOW the price chart (y > svgHeight), so the
// price chart, volume, OI, and L/S each get their own non-overlapping
// section — same idea as how most charting platforms stack sub-panes.
// Panels only take up space when their checkbox is on; toggling one off
// closes the gap rather than leaving a blank band.
const PANEL_GAP = 10

const panelLayout = computed(() => {
  let cursor = svgHeight // bottom edge of the price chart — panels start here
  let volume: { top: number; bottom: number } | null = null
  let movement: { top: number; bottom: number } | null = null
  let oi: { top: number; bottom: number } | null = null
  let ls: { top: number; bottom: number } | null = null

  if (showVolume.value) {
    const top = cursor + PANEL_GAP
    const bottom = top + VOLUME_PANEL_HEIGHT
    volume = { top, bottom }
    cursor = bottom
  }
  if (showMovementPanel.value) {
    const top = cursor + PANEL_GAP
    const bottom = top + MOVEMENT_PANEL_HEIGHT
    movement = { top, bottom }
    cursor = bottom
  }
  if (showOiBar.value) {
    const top = cursor + PANEL_GAP
    const bottom = top + OI_PANEL_HEIGHT
    oi = { top, bottom }
    cursor = bottom
  }
  if (showLongShortRatio.value) {
    const top = cursor + PANEL_GAP
    const bottom = top + LS_PANEL_HEIGHT
    ls = { top, bottom }
    cursor = bottom
  }

  return { volume, movement, oi, ls, totalHeight: cursor }
})

/** Full SVG canvas height — price chart height plus whichever indicator panels are currently active. Since the SVG has no viewBox/CSS scaling, 1 unit here is 1 rendered pixel, so growing this is safe and doesn't distort price-chart math (which still keys off the constant `svgHeight`). */
const totalSvgHeight = computed(() => panelLayout.value.totalHeight)

// ─── Volume panel (own section below the price chart) ─────────────────────────
/** Reserved pixel height for the volume panel. */
const VOLUME_PANEL_HEIGHT = 100
/** Tallest bar uses at most this fraction of the reserved panel height. */
const VOLUME_PANEL_MAX_RATIO = 0.9
/** Height actually usable by the tallest bar (for label positioning). */
const volumePanelUsableHeight = VOLUME_PANEL_HEIGHT * VOLUME_PANEL_MAX_RATIO

/** Highest `candle.volume` currently in view — used to scale bar heights. */
const maxVolumeInView = computed(() => {
  let max = 0
  for (const c of displayCandles.value) {
    const v = c.volume ?? 0
    if (v > max) max = v
  }
  return max
})

/** One bar per candle, anchored to the bottom of its own panel (grows upward), scaled by volume. */
const volumeBars = computed(() => {
  if (maxVolumeInView.value <= 0 || !panelLayout.value.volume) return []
  const panelBottom = panelLayout.value.volume.bottom
  return displayCandles.value.map((candle, i) => {
    const vol = candle.volume ?? 0
    const barHeight = (vol / maxVolumeInView.value) * volumePanelUsableHeight
    return {
      x: candleX(i) - candleWidth.value / 2,
      y: panelBottom - barHeight,
      width: candleWidth.value,
      height: barHeight,
      isBull: candle.close! >= candle.open!,
    }
  })
})

// ─── Wallet Movement panel (exchange inflow/outflow) ───────────────────────────
//
// Backed by whale_tracker_api.py (Flask), which scans ERC-20 Transfer events
// touching known exchange hot wallets and classifies each as INFLOW (token ->
// exchange, possible sell pressure) or OUTFLOW (exchange -> token, possible
// accumulation). Fetched once per "See Movement" click across the whole
// visible candle range (via ?start=&end=), then bucketed client-side into
// one entry per candle by matching each transfer's timestamp against that
// candle's [openTime, openTime + intervalMs) window — same as-of technique
// as oiPerCandle below, just bucketed instead of forward-filled since
// movement is sparse/event-based rather than a continuous series.
// NOTE: adjust this to wherever your whale_tracker_api.py Flask app is served
const WALLET_MOVEMENT_API_BASE = 'http://127.0.0.1:5000'

const walletMovements = ref<WalletMovement[]>([])
const movementLoading = ref(false)
const movementError = ref<string | null>(null)

interface MovementCacheEntry {
  movements: WalletMovement[]
  startMs: number
  endMs: number
  cachedAt: number
}

// Cache of the last successful movement fetch per symbol+interval, persisted
// to localStorage so switching back to a pair/timeframe you've already
// pulled movement for — or just reloading the page — shows it immediately
// instead of making you press "See Movement" again.
const MOVEMENT_CACHE_STORAGE_KEY = 'candleVisualizer.movementCache.v1'
const MOVEMENT_CACHE_MAX_ENTRIES = 20 // oldest entries (by cachedAt) get evicted past this

function loadMovementCacheFromStorage(): Record<string, MovementCacheEntry> {
  try {
    const raw = localStorage.getItem(MOVEMENT_CACHE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {} // corrupt entry, storage disabled (private browsing), etc. — start fresh
  }
}

const movementCache = ref<Record<string, MovementCacheEntry>>(loadMovementCacheFromStorage())

/** Writes the current cache to localStorage, trimming to the most-recently-cached entries so it can't grow unbounded. */
function persistMovementCache() {
  const entries = Object.entries(movementCache.value)
  const trimmedEntries = entries
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
    .slice(0, MOVEMENT_CACHE_MAX_ENTRIES)
  const trimmed = Object.fromEntries(trimmedEntries)
  if (trimmedEntries.length < entries.length) movementCache.value = trimmed
  try {
    localStorage.setItem(MOVEMENT_CACHE_STORAGE_KEY, JSON.stringify(trimmed))
  } catch (err) {
    // Quota exceeded or storage unavailable — the in-memory cache still
    // works for the rest of this session, it just won't survive a reload.
    console.warn('[movement cache] failed to persist to localStorage', err)
  }
}

function movementCacheKey(symbol: string, interval: string): string {
  return `${symbol.toUpperCase()}|${interval}`
}

async function fetchWalletMovement(options: { silent?: boolean } = {}) {
  if (!props.symbol || displayCandles.value.length === 0) return
  if (!options.silent) showMovementPanel.value = true
  movementLoading.value = true
  movementError.value = null
  try {
    const first = displayCandles.value[0]
    const last = displayCandles.value[displayCandles.value.length - 1]
    if (first.openTime == null || last.openTime == null) throw new Error('candles are missing openTime')

    // The last displayed candle may still be live/in-progress, in which case
    // openTime + intervalMs (its scheduled close) is a timestamp in the
    // future. Etherscan's getblocknobytime can't resolve a block for a time
    // that hasn't happened yet ("Block timestamp too far in the future"), so
    // clamp end to "now" — never send a future end timestamp.
    const rawEndMs = last.openTime + intervalToMs(props.interval)
    const endMs = Math.min(rawEndMs, Date.now())

    const startIso = new Date(first.openTime).toISOString()
    const endIso = new Date(endMs).toISOString()
    const url = `${WALLET_MOVEMENT_API_BASE}/api/movement?symbol=${encodeURIComponent(props.symbol.toUpperCase())}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`

    const res = await fetch(url)
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error || `request failed (${res.status})`)

    walletMovements.value = Array.isArray(body) ? body : []
    movementCache.value = {
      ...movementCache.value,
      [movementCacheKey(props.symbol, props.interval)]: {
        movements: walletMovements.value,
        startMs: first.openTime,
        endMs,
        cachedAt: Date.now(),
      },
    }
    persistMovementCache()
  } catch (err) {
    // A background (silent) refresh failing shouldn't blank out or flag an
    // error over movement data that's already on screen from cache — just
    // leave the cached bars as-is and try again next time. Only surface the
    // error when the user actually asked for a fresh load.
    if (!options.silent) {
      movementError.value = err instanceof Error ? err.message : 'failed to load wallet movement'
      walletMovements.value = []
    }
  } finally {
    movementLoading.value = false
  }
}

/**
 * Shows cached wallet movement for the current symbol+interval immediately
 * (no network wait, no button press) if we have any — including across page
 * reloads, since the cache is persisted to localStorage — then quietly
 * refetches in the background to fill in anything that's happened since it
 * was cached. No-op (leaves the panel exactly as it is) when there's nothing
 * cached yet.
 */
function tryShowCachedMovement() {
  if (!props.symbol) return
  const cached = movementCache.value[movementCacheKey(props.symbol, props.interval)]
  if (!cached) return
  walletMovements.value = cached.movements
  movementError.value = null
  showMovementPanel.value = true
  fetchWalletMovement({ silent: true })
}

interface MovementBucket {
  inflow: number
  outflow: number
  records: WalletMovement[]
}

/** One bucket per displayed candle — sums inflow/outflow and keeps the raw records for the detail dialog. */
const movementPerCandle = computed<MovementBucket[]>(() => {
  const buckets: MovementBucket[] = displayCandles.value.map(() => ({ inflow: 0, outflow: 0, records: [] }))
  if (walletMovements.value.length === 0) return buckets

  const intervalMs = intervalToMs(props.interval)
  for (const mv of walletMovements.value) {
    const ts = new Date(mv.timestamp).getTime()
    if (isNaN(ts)) continue

    for (let i = displayCandles.value.length - 1; i >= 0; i--) {
      const c = displayCandles.value[i]
      if (c.openTime == null) continue
      if (ts >= c.openTime && ts < c.openTime + intervalMs) {
        const bucket = buckets[i]
        if (mv.type === 'INFLOW') bucket.inflow += mv.amount
        else bucket.outflow += mv.amount
        bucket.records.push(mv)
        break
      }
    }
  }
  return buckets
})

/** Highest single-candle (inflow + outflow) total currently in view — used to scale bar heights. */
const maxMovementInView = computed(() => {
  let max = 0
  for (const b of movementPerCandle.value) {
    const total = b.inflow + b.outflow
    if (total > max) max = total
  }
  return max
})

const MOVEMENT_PANEL_HEIGHT = 90
const MOVEMENT_PANEL_MAX_RATIO = 0.9
const movementPanelUsableHeight = MOVEMENT_PANEL_HEIGHT * MOVEMENT_PANEL_MAX_RATIO

/**
 * One stacked bar per candle, anchored to the bottom of its own panel like
 * volumeBars — total height scaled by (inflow + outflow) vs the max in view,
 * split into a green inflow segment (top) and a red outflow segment
 * (bottom, picking up exactly where inflow left off).
 */
const movementBars = computed(() => {
  if (maxMovementInView.value <= 0 || !panelLayout.value.movement) return []
  const panelBottom = panelLayout.value.movement.bottom

  return movementPerCandle.value.map((bucket, i) => {
    const total = bucket.inflow + bucket.outflow
    const x = candleX(i) - candleWidth.value / 2
    const width = candleWidth.value

    if (total <= 0) {
      return { index: i, x, width, inflowY: panelBottom, inflowHeight: 0, outflowY: panelBottom, outflowHeight: 0 }
    }

    const totalHeight = (total / maxMovementInView.value) * movementPanelUsableHeight
    const inflowHeight = (bucket.inflow / total) * totalHeight
    const outflowHeight = totalHeight - inflowHeight

    return {
      index: i,
      x,
      width,
      inflowY: panelBottom - totalHeight,
      inflowHeight,
      outflowY: panelBottom - totalHeight + inflowHeight,
      outflowHeight,
    }
  })
})

/** Opens the movement detail dialog for a given candle index, if it actually has any recorded movement. */
function openMovementDetail(index: number) {
  const bucket = movementPerCandle.value[index]
  if (!bucket || bucket.records.length === 0) return
  selectedMovementCandleIndex.value = index
  showMovementDetail.value = true
}

const selectedMovementBucket = computed<MovementBucket | null>(() =>
  selectedMovementCandleIndex.value !== null ? movementPerCandle.value[selectedMovementCandleIndex.value] : null
)
const selectedMovementCandle = computed<CandleEntry | null>(() =>
  selectedMovementCandleIndex.value !== null ? displayCandles.value[selectedMovementCandleIndex.value] : null
)

// Symbol/interval changed: show cached movement for the new pair/timeframe
// immediately if we have it (refreshing quietly in the background); if we
// don't have it cached but the panel was already open, fall back to a
// normal fresh fetch so it doesn't just sit there showing the old pair's data.
watch(() => [props.symbol, props.interval], () => {
  const hadCache = movementCache.value[movementCacheKey(props.symbol, props.interval)] !== undefined
  if (hadCache) {
    tryShowCachedMovement()
  } else if (showMovementPanel.value) {
    fetchWalletMovement()
  }
})

// ─── Summarize Movement tool ────────────────────────────────────────────────
//
// Same click-drag box mechanic as Range Download/Range Investigate, kept as
// its own independent tool/state. Instead of exporting or running the
// driver-classification engine, the box's "📊 Summarize" button just totals
// movementPerCandle's inflow/outflow across the selected span and opens a
// dialog with the totals plus a per-candle horizontal bar chart — no
// network fetch, since it's built entirely from wallet movement data
// already loaded via "See Movement" / fetchWalletMovement.
interface SummarizeBox {
  id: number
  startIndex: number
  endIndex: number
}

const summarizeModeActive = ref(false)
const summarizeBoxes = ref<SummarizeBox[]>([])
let summarizeIdCounter = 0

const summarizeDragging = ref(false)
const summarizeStartIndex = ref<number | null>(null)
const summarizeEndIndex = ref<number | null>(null)

function toggleSummarizeMode() {
  summarizeModeActive.value = !summarizeModeActive.value
}

function removeSummarizeBox(id: number) {
  summarizeBoxes.value = summarizeBoxes.value.filter(b => b.id !== id)
  if (currentSummarizeBoxId.value === id) currentSummarizeBoxId.value = null
}

function findSummarizeBox(id: number): SummarizeBox | undefined {
  return summarizeBoxes.value.find(b => b.id === id)
}

/** Drag the left edge of a placed summarize box to adjust startIndex, same as the Range Download/Investigate edge handles. */
function startSummarizeResizeLeft(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const box = findSummarizeBox(id)
  if (!box) return

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.round(raw)
    box.startIndex = Math.max(0, Math.min(snapped, box.endIndex - 1))
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Drag the right edge of a placed summarize box to adjust endIndex. */
function startSummarizeResizeRight(id: number, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const box = findSummarizeBox(id)
  if (!box) return

  const handleMove = (moveEvent: MouseEvent) => {
    const raw = clientXToCandleIndex(moveEvent.clientX)
    if (raw === null) return
    const snapped = Math.max(0, Math.min(displayCandles.value.length - 1, Math.round(raw)))
    box.endIndex = Math.max(box.startIndex + 1, snapped)
  }
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

/** Pixel geometry for a summarize box — identical framing to computeRangeDownloadBoxGeometry (high↔low of every candle in the span). */
function computeSummarizeBoxGeometry(startIndex: number, endIndex: number) {
  const candles = displayCandles.value.slice(startIndex, endIndex + 1)
  if (candles.length === 0) return null

  let rangeLow = Infinity
  let rangeHigh = -Infinity
  for (const c of candles) {
    if (c.low == null || c.high == null) continue
    if (c.low < rangeLow) rangeLow = c.low
    if (c.high > rangeHigh) rangeHigh = c.high
  }
  if (!isFinite(rangeLow) || !isFinite(rangeHigh) || rangeHigh <= rangeLow) return null

  return {
    leftX: candleX(startIndex) - candleWidth.value / 2,
    rightX: candleX(endIndex) + candleWidth.value / 2,
    rangeTop: priceToY(rangeHigh),
    rangeBottom: priceToY(rangeLow),
  }
}

/** All finalized (click-drag-completed) summarize boxes, recomputed reactively as price scale/zoom changes. */
const renderedSummarizeBoxes = computed(() => {
  return summarizeBoxes.value
    .map(b => {
      const geo = computeSummarizeBoxGeometry(b.startIndex, b.endIndex)
      return geo ? { ...geo, id: b.id, startIndex: b.startIndex, endIndex: b.endIndex } : null
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
})

/** Live preview of the box while the user is still dragging. */
const draggingSummarizePreview = computed(() => {
  if (!summarizeDragging.value || summarizeStartIndex.value === null || summarizeEndIndex.value === null) return null
  const s = Math.min(summarizeStartIndex.value, summarizeEndIndex.value)
  const e = Math.max(summarizeStartIndex.value, summarizeEndIndex.value)
  if (e <= s) return null
  return computeSummarizeBoxGeometry(s, e)
})

function handleCandleMouseDownForSummarize(index: number, event: MouseEvent) {
  if (!summarizeModeActive.value) return
  event.preventDefault()
  event.stopPropagation()

  summarizeDragging.value = true
  summarizeStartIndex.value = index
  summarizeEndIndex.value = index

  const handleMove = (moveEvent: MouseEvent) => {
    if (!summarizeDragging.value || !chartContainer.value) return
    const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
    if (!rect) return
    const x = moveEvent.clientX - rect.left
    const rawIndex = Math.round((x - 10 - candleWidth.value / 2) / (candleWidth.value + candleGap))
    summarizeEndIndex.value = Math.max(0, Math.min(displayCandles.value.length - 1, rawIndex))
  }

  const handleUp = () => {
    if (summarizeStartIndex.value !== null && summarizeEndIndex.value !== null) {
      const s = Math.min(summarizeStartIndex.value, summarizeEndIndex.value)
      const e = Math.max(summarizeStartIndex.value, summarizeEndIndex.value)
      if (e > s) {
        summarizeBoxes.value.push({ id: ++summarizeIdCounter, startIndex: s, endIndex: e })
      }
    }
    summarizeDragging.value = false
    summarizeStartIndex.value = null
    summarizeEndIndex.value = null
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

// Which box's summary is currently shown in the dialog.
const showMovementSummary = ref(false)
const currentSummarizeBoxId = ref<number | null>(null)
const currentSummarizeBox = computed(() => {
  if (currentSummarizeBoxId.value === null) return null
  return findSummarizeBox(currentSummarizeBoxId.value) ?? null
})

interface MovementSummaryResult {
  symbol: string
  interval: string
  candleCount: number
  rangeStartTimeIso: string
  rangeEndTimeIso: string
  totalInflow: number
  totalOutflow: number
  net: number
  maxTotal: number
}

/** Totals inflow/outflow across the box's candle span from movementPerCandle (already loaded, no fetch) — just the range totals, no per-candle breakdown. */
const movementSummaryResult = computed<MovementSummaryResult | null>(() => {
  const box = currentSummarizeBox.value
  if (!box) return null

  const buckets = movementPerCandle.value.slice(box.startIndex, box.endIndex + 1)
  const candles = displayCandles.value.slice(box.startIndex, box.endIndex + 1)
  if (buckets.length === 0) return null

  let totalInflow = 0
  let totalOutflow = 0
  for (const bucket of buckets) {
    totalInflow += bucket.inflow
    totalOutflow += bucket.outflow
  }

  const first = candles[0]
  const last = candles[candles.length - 1]
  const rangeStartTimeIso = first?.openTime != null ? new Date(first.openTime).toISOString() : ''
  const rangeEndTimeIso = last?.openTime != null ? new Date(last.openTime + intervalToMs(props.interval)).toISOString() : ''

  return {
    symbol: props.symbol.toUpperCase(),
    interval: props.interval,
    candleCount: buckets.length,
    rangeStartTimeIso,
    rangeEndTimeIso,
    totalInflow,
    totalOutflow,
    net: totalInflow - totalOutflow,
    maxTotal: Math.max(totalInflow, totalOutflow),
  }
})

/** Opens the summary dialog for a given box — no fetch, just totals movementPerCandle over the selected span. */
function summarizeMovementRange(id: number) {
  currentSummarizeBoxId.value = id
  showMovementSummary.value = true
}

// ─── Open Interest bar panel ────────────────────────────────────────────────
//
// Binance's kline endpoint has no per-candle OI field, so unlike volume this
// needs its own fetch: the futures Open Interest History endpoint
// (/futures/data/openInterestHist), which only samples on a fixed set of
// periods (5m/15m/30m/1h/2h/4h/6h/12h/1d) — not arbitrary kline intervals.
// We fetch on that nearest supported period and then, for each displayed
// candle, look up the most recent OI sample at or before that candle's
// close time. Rendered as its own yellow bar band directly above the
// volume band (same technique as volumeBars, just a second row).
interface OiHistoryEntry {
  timestamp: number
  sumOpenInterest: number
}

const OI_SUPPORTED_PERIODS = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']

const oiHistory = ref<OiHistoryEntry[]>([])
const oiLoading = ref(false)
const oiError = ref<string | null>(null)

/** Binance's OI-history endpoint only supports a fixed set of periods — pick whichever is closest to the kline interval actually in use. */
function resolveOiPeriod(interval: string): string {
  if (OI_SUPPORTED_PERIODS.includes(interval)) return interval
  const wantedMs = intervalToMs(interval)
  let best = OI_SUPPORTED_PERIODS[0]
  let bestDiff = Infinity
  for (const period of OI_SUPPORTED_PERIODS) {
    const diff = Math.abs(intervalToMs(period) - wantedMs)
    if (diff < bestDiff) {
      bestDiff = diff
      best = period
    }
  }
  return best
}

async function fetchOiHistory() {
  if (!props.symbol) return
  oiLoading.value = true
  oiError.value = null
  try {
    const period = resolveOiPeriod(props.interval)
    const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${props.symbol.toUpperCase()}&period=${period}&limit=500`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`request failed (${res.status})`)
    const data = await res.json()
    oiHistory.value = (Array.isArray(data) ? data : []).map((d: any) => ({
      timestamp: Number(d.timestamp),
      sumOpenInterest: parseFloat(d.sumOpenInterest),
    }))
  } catch (err) {
    oiError.value = err instanceof Error ? err.message : 'failed to load OI history'
    oiHistory.value = []
  } finally {
    oiLoading.value = false
  }
}

// Fetch the first time the checkbox is turned on, and whenever the symbol
// or interval changes while it's already on (stale OI history for a
// different pair/timeframe would otherwise just sit there silently).
watch(showOiBar, (active) => {
  if (active) fetchOiHistory()
})
watch(() => [props.symbol, props.interval], () => {
  if (showOiBar.value) fetchOiHistory()
})

/**
 * Maps each displayed candle to the most recent OI sample at or before that
 * candle's close time. `oiHistory` and `displayCandles` both run oldest→
 * newest, so a single forward-only pointer over the sorted samples covers
 * every candle in one pass.
 */
const oiPerCandle = computed<(number | null)[]>(() => {
  if (oiHistory.value.length === 0) return displayCandles.value.map(() => null)

  const intervalMs = intervalToMs(props.interval)
  const sorted = [...oiHistory.value].sort((a, b) => a.timestamp - b.timestamp)
  let sIdx = 0

  return displayCandles.value.map(candle => {
    if (candle.openTime == null) return null
    const cutoff = candle.openTime + intervalMs
    while (sIdx + 1 < sorted.length && sorted[sIdx + 1].timestamp <= cutoff) sIdx++
    return sorted[sIdx].timestamp <= cutoff ? sorted[sIdx].sumOpenInterest : null
  })
})

/** Highest OI value currently in view — used to scale bar heights, same idea as maxVolumeInView. */
const maxOiInView = computed(() => {
  let max = 0
  for (const v of oiPerCandle.value) {
    if (v != null && v > max) max = v
  }
  return max
})

/**
 * Lowest OI value currently in view. Needed because open interest — unlike
 * volume — never dips anywhere near zero; it moves in a narrow band (e.g.
 * 95k–100k contracts). Scaling bar height as value/max (anchored at zero)
 * would put every single bar at ~95–100% of the panel height, making them
 * all look the same. Scaling against the actual min↔max range in view
 * instead turns the real fluctuation into a visible relative bar chart.
 */
const minOiInView = computed(() => {
  let min = Infinity
  for (const v of oiPerCandle.value) {
    if (v != null && v < min) min = v
  }
  return min === Infinity ? 0 : min
})

const OI_PANEL_HEIGHT = 70
const OI_PANEL_MAX_RATIO = 0.9
const oiPanelUsableHeight = OI_PANEL_HEIGHT * OI_PANEL_MAX_RATIO
/** Floor so the lowest bar in view is still a visible sliver rather than a 0px line. */
const OI_BAR_MIN_HEIGHT_RATIO = 0.08

/** One bar per candle with a known OI sample, anchored to the bottom of its own panel (grows upward) and scaled against the min↔max OI range currently in view. */
const oiBars = computed(() => {
  const max = maxOiInView.value
  const min = minOiInView.value
  if (max <= 0 || !panelLayout.value.oi) return []
  const range = max - min
  const baseline = panelLayout.value.oi.bottom
  const bars: { x: number; y: number; width: number; height: number }[] = []
  oiPerCandle.value.forEach((val, i) => {
    if (val == null) return
    // Flat data (range === 0) falls back to a uniform mid-height bar instead of div-by-zero.
    const ratio = range > 0
      ? OI_BAR_MIN_HEIGHT_RATIO + ((val - min) / range) * (1 - OI_BAR_MIN_HEIGHT_RATIO)
      : 0.5
    const barHeight = ratio * oiPanelUsableHeight
    bars.push({
      x: candleX(i) - candleWidth.value / 2,
      y: baseline - barHeight,
      width: candleWidth.value,
      height: barHeight,
    })
  })
  return bars
})

// ─── Long/Short Ratio panel ─────────────────────────────────────────────────
//
// Binance's Top/Global Long-Short Account Ratio endpoint
// (/futures/data/globalLongShortAccountRatio) is sampled on the same fixed
// period set as the OI-history endpoint, so it shares resolveOiPeriod() and
// the same as-of matching approach as oiPerCandle above.
//
// Rendered as a single STACKED column per candle rather than a net-deviation
// histogram: longAccount + shortAccount always sum to 1.0, so each candle's
// column is just split at that proportion — green (long %) fills from the
// panel's top edge down, red (short %) picks up exactly where green stopped
// and fills the rest. A dashed line marks the 50/50 point for reference.
// Sits directly above the OI band.
interface LsRatioEntry {
  timestamp: number
  longAccount: number
  shortAccount: number
}

const showLongShortRatio = ref(false)
const lsRatioHistory = ref<LsRatioEntry[]>([])
const lsRatioLoading = ref(false)
const lsRatioError = ref<string | null>(null)

async function fetchLongShortRatio() {
  if (!props.symbol) return
  lsRatioLoading.value = true
  lsRatioError.value = null
  try {
    const period = resolveOiPeriod(props.interval) // same supported period set as OI history
    const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${props.symbol.toUpperCase()}&period=${period}&limit=500`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`request failed (${res.status})`)
    const data = await res.json()
    lsRatioHistory.value = (Array.isArray(data) ? data : []).map((d: any) => ({
      timestamp: Number(d.timestamp),
      longAccount: parseFloat(d.longAccount),
      shortAccount: parseFloat(d.shortAccount),
    }))
  } catch (err) {
    lsRatioError.value = err instanceof Error ? err.message : 'failed to load long/short ratio'
    lsRatioHistory.value = []
  } finally {
    lsRatioLoading.value = false
  }
}

watch(showLongShortRatio, (active) => {
  if (active) fetchLongShortRatio()
})
watch(() => [props.symbol, props.interval], () => {
  if (showLongShortRatio.value) fetchLongShortRatio()
})

/** Same as-of forward-fill approach as oiPerCandle — see that comment for why. */
const lsRatioPerCandle = computed<({ longAccount: number; shortAccount: number } | null)[]>(() => {
  if (lsRatioHistory.value.length === 0) return displayCandles.value.map(() => null)

  const intervalMs = intervalToMs(props.interval)
  const sorted = [...lsRatioHistory.value].sort((a, b) => a.timestamp - b.timestamp)
  let sIdx = 0

  return displayCandles.value.map(candle => {
    if (candle.openTime == null) return null
    const cutoff = candle.openTime + intervalMs
    while (sIdx + 1 < sorted.length && sorted[sIdx + 1].timestamp <= cutoff) sIdx++
    if (sorted[sIdx].timestamp > cutoff) return null
    return { longAccount: sorted[sIdx].longAccount, shortAccount: sorted[sIdx].shortAccount }
  })
})

const LS_PANEL_HEIGHT = 60

/** Top edge of the L/S panel's own section (own band, computed from panelLayout). */
const lsRatioPanelTopY = computed(() => panelLayout.value.ls?.top ?? 0)
/** 50/50 reference line, vertically centered in the L/S band. */
const lsRatioCenterY = computed(() => lsRatioPanelTopY.value + LS_PANEL_HEIGHT / 2)

/** Lowest longAccount fraction currently in view. */
const minLongAccountInView = computed(() => {
  let min = Infinity
  for (const e of lsRatioPerCandle.value) {
    if (e != null && e.longAccount < min) min = e.longAccount
  }
  return min === Infinity ? 0 : min
})

/** Highest longAccount fraction currently in view. */
const maxLongAccountInView = computed(() => {
  let max = -Infinity
  for (const e of lsRatioPerCandle.value) {
    if (e != null && e.longAccount > max) max = e.longAccount
  }
  return max === -Infinity ? 1 : max
})

/** Floor/ceiling so even the most extreme bar in view still shows a sliver of the other color, rather than 0px. */
const LS_BAR_EDGE_MARGIN_RATIO = 0.08

/**
 * One stacked column per candle: green segment on top (long%), red on the
 * bottom (short%), red starting exactly where green ends.
 *
 * The split point is NOT plotted on the literal 0–100% axis. Global
 * long/short splits rarely move more than a few percentage points day to
 * day, so on a true 0–100% scale every column looks identical (same
 * flattening problem the OI band had). Instead the long% axis is zoomed to
 * the actual min↔max longAccount seen in view — the lowest long% in view
 * maps near the bottom of the panel, the highest near the top — so real
 * fluctuation is actually visible as the split line moving up and down.
 * This trades literal "58% long" accuracy for a readable relative read;
 * exact values are still in lsRatioPerCandle if you want a numeric label.
 */
const lsRatioBars = computed(() => {
  if (!panelLayout.value.ls) return []
  const topY = lsRatioPanelTopY.value
  const min = minLongAccountInView.value
  const max = maxLongAccountInView.value
  const range = max - min
  const bars: { x: number; y: number; width: number; height: number; long: boolean }[] = []

  lsRatioPerCandle.value.forEach((entry, i) => {
    if (entry == null) return
    const x = candleX(i) - candleWidth.value / 2

    const zoomedLongFraction = range > 0
      ? LS_BAR_EDGE_MARGIN_RATIO + ((entry.longAccount - min) / range) * (1 - 2 * LS_BAR_EDGE_MARGIN_RATIO)
      : 0.5

    const longHeight = zoomedLongFraction * LS_PANEL_HEIGHT
    const shortHeight = LS_PANEL_HEIGHT - longHeight

    bars.push({ x, y: topY, width: candleWidth.value, height: longHeight, long: true })
    bars.push({ x, y: topY + longHeight, width: candleWidth.value, height: shortHeight, long: false })
  })

  return bars
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
const priceToY = (price: number): number => {
  return ((maxPrice.value - price) / priceDelta.value) * svgHeight
}

/** Inverse of priceToY — converts an SVG y-coordinate back into a price. */
const yToPrice = (y: number): number => {
  return maxPrice.value - (y / svgHeight) * priceDelta.value
}

const candleX = (index: number): number => {
  // multiTfPrependOffsetSlots shifts every index right by however many slots
  // are reserved for prepended higher-TF lead-in candles (0 when none are
  // active/available) — see the "Multi-TF lead-in candles" section. Passing
  // a negative index (used only by multiTfPrependRenderBars) lands inside
  // that reserved region instead of overlapping base index 0.
  return (index + multiTfPrependOffsetSlots.value) * (candleWidth.value + candleGap) + candleWidth.value / 2 + 10
}

/**
 * True when `index` should be dimmed because its volume is lower than the
 * currently-hovered candle's volume. No-op (never muted) when nothing is
 * hovered, or for the hovered candle itself.
 */
const isCandleMuted = (index: number): boolean => {
  if (hoveredCandleIndex.value === null || index === hoveredCandleIndex.value) return false
  const hoveredVolume = displayCandles.value[hoveredCandleIndex.value]?.volume
  const thisVolume = displayCandles.value[index]?.volume
  if (hoveredVolume == null || thisVolume == null) return false
  return thisVolume < hoveredVolume
}

const handleZoom = (event: WheelEvent) => {
  event.preventDefault()
  const direction = event.deltaY > 0 ? -1 : 1
  const newWidth = candleWidth.value + direction * zoomSensitivity * 5
  if (newWidth >= minCandleWidth && newWidth <= maxCandleWidth) {
    candleWidth.value = newWidth
  }
}

const handleMouseMove = (event: MouseEvent) => {
  if (!chartContainer.value || !crosshairGroup.value) return
  const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
  if (!rect) return
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const h = crosshairGroup.value.querySelector('.crosshair-line.horizontal') as SVGLineElement
  const v = crosshairGroup.value.querySelector('.crosshair-line.vertical') as SVGLineElement
  if (h) { h.setAttribute('y1', String(y)); h.setAttribute('y2', String(y)); h.style.display = 'block' }
  if (v) { v.setAttribute('x1', String(x)); v.setAttribute('x2', String(x)); v.style.display = 'block' }
}

const handleMouseLeave = () => {
  if (!crosshairGroup.value) return
  const h = crosshairGroup.value.querySelector('.crosshair-line.horizontal') as SVGLineElement
  const v = crosshairGroup.value.querySelector('.crosshair-line.vertical') as SVGLineElement
  if (h) h.style.display = 'none'
  if (v) v.style.display = 'none'
}

const startChartDrag = (event: MouseEvent) => {
  if ((event.target as SVGElement).classList?.contains('price-label')) return
  if (vpModeActive.value) return // let handleCandleMouseDownForVp own dragging while the VP tool is armed
  isDraggingChart = true
  const startX = event.clientX
  const startY = event.clientY
  const startScrollLeft = chartContainer.value?.scrollLeft || 0
  const startMinPrice = minPrice.value
  const startMaxPrice = maxPrice.value
  const originalRange = startMaxPrice - startMinPrice

  const handleDragMove = (moveEvent: MouseEvent) => {
    if (!isDraggingChart || !chartContainer.value) return
    chartContainer.value.scrollLeft = startScrollLeft - (moveEvent.clientX - startX)
    const priceShift = ((moveEvent.clientY - startY) / svgHeight) * originalRange
    priceRangeMin.value = startMinPrice + priceShift
    priceRangeMax.value = startMaxPrice + priceShift
  }

  const handleDragEnd = () => {
    isDraggingChart = false
    document.removeEventListener('mousemove', handleDragMove)
    document.removeEventListener('mouseup', handleDragEnd)
  }

  document.addEventListener('mousemove', handleDragMove)
  document.addEventListener('mouseup', handleDragEnd)
}

const startPriceAdjust = (price: number, index: number, event: MouseEvent) => {
  event.preventDefault()
  isAdjustingHeight = true
  const startY = event.clientY
  const originalRange = maxPrice.value - minPrice.value

  const handleMove = (moveEvent: MouseEvent) => {
    const priceShift = ((moveEvent.clientY - startY) / svgHeight) * originalRange
    const newMin = minPrice.value - priceShift
    const newMax = maxPrice.value + priceShift
    if (newMax - newMin > originalRange * 0.1) {
      priceRangeMin.value = newMin
      priceRangeMax.value = newMax
    }
  }

  const handleUp = () => {
    isAdjustingHeight = false
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

const openCandleModal = (index: number) => {
  selectedCandleIndex.value = index
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
  selectedCandleIndex.value = null
}

const formatValue = (value: any): string => {
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<style scoped>
.candle-visualizer {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: #1a1a1a;
  border-radius: 8px;
  overflow-x: auto;
}

.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem;
  flex-wrap: wrap;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.checkbox-label input {
  cursor: pointer;
  width: 16px;
  height: 16px;
}

/* ── Generic tool button (Volume Profile, etc.) ───────────────────────── */
.tool-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid #444;
  background: rgba(255,255,255,0.06);
  color: #ccc;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
}

.tool-btn:hover {
  background: rgba(255,255,255,0.12);
}

.tool-btn-active {
  background: rgba(100,149,237,0.25);
  border-color: #6495ed;
  color: #a9c2f7;
}

/* Simple click-toggled dropdown (e.g. "Fill PZ AVWAP ▾") — wrapper is
   inline-block + relative so the menu can anchor directly under its button. */
.tool-dropdown {
  position: relative;
  display: inline-block;
}

.tool-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  overflow: hidden;
}

.tool-dropdown-item {
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: #ccc;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.tool-dropdown-item:hover {
  background: rgba(255,255,255,0.1);
  color: #fff;
}

/* ── Preview controls ──────────────────────────────────────────────────── */
.preview-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.margin-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #999;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.margin-input {
  width: 80px;
  padding: 4px 8px;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  font-family: monospace;
}

.margin-input.small {
  width: 64px;
}

.margin-input:focus {
  outline: none;
  border-color: #64b5f6;
}

.preview-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.1s ease;
  white-space: nowrap;
}

.preview-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.preview-btn:not(:disabled):hover {
  transform: translateY(-1px);
}

.preview-btn.buy {
  background: rgba(38,166,154,0.2);
  border-color: #26a69a;
  color: #26a69a;
}

.preview-btn.buy:not(:disabled):hover {
  background: rgba(38,166,154,0.35);
}

.preview-btn.sell {
  background: rgba(239,83,80,0.2);
  border-color: #ef5350;
  color: #ef5350;
}

.preview-btn.sell:not(:disabled):hover {
  background: rgba(239,83,80,0.35);
}

.preview-btn.clear {
  background: rgba(255,255,255,0.06);
  border-color: #555;
  color: #ccc;
}

.preview-btn.clear:not(:disabled):hover {
  background: rgba(255,255,255,0.12);
}

/* ── Preview summary panel ─────────────────────────────────────────────── */
.preview-panel {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  border-left: 3px solid #555;
  position: relative;
}

.preview-panel.long { border-left-color: #26a69a; }
.preview-panel.short { border-left-color: #ef5350; }

.preview-side-badge {
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 0.4px;
}

.preview-side-badge.long { background: rgba(38,166,154,0.3); color: #26a69a; }
.preview-side-badge.short { background: rgba(239,83,80,0.3); color: #ef5350; }

.preview-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-family: monospace;
  color: #fff;
}

.preview-stat label {
  color: #999;
  font-family: inherit;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.4px;
}

.preview-stat.tp span:last-child { color: #26a69a; }
.preview-stat.sl span:last-child { color: #ef5350; }
.preview-stat.rr span:last-child { color: #64b5f6; font-weight: bold; }
.preview-stat.rr.rr-bad span:last-child { color: #ef5350; }

.preview-btn.place-order {
  background: rgba(100,181,246,0.2);
  border-color: #64b5f6;
  color: #64b5f6;
}

.preview-btn.place-order:not(:disabled):hover {
  background: rgba(100,181,246,0.35);
}

.preview-price-input {
  width: 90px;
  padding: 2px 6px;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 4px;
  font-size: 13px;
  font-family: monospace;
}

.preview-price-input:focus {
  outline: none;
  border-color: #64b5f6;
}

.preview-price-input.tp { color: #26a69a; border-color: rgba(38,166,154,0.4); }
.preview-price-input.sl { color: #ef5350; border-color: rgba(239,83,80,0.4); }

/* Hide native number-input spinner arrows so the field reads like the
   plain price readout it replaced. */
.preview-price-input::-webkit-outer-spin-button,
.preview-price-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.preview-price-input[type="number"] {
  -moz-appearance: textfield;
}

.preview-panel-close {
  margin-left: auto;
  background: none;
  border: none;
  color: #999;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.preview-panel-close:hover { color: #fff; }

.preview-error {
  color: #ef5350;
  font-size: 13px;
  padding: 0 0.5rem;
}

/* ── Preview TP/SL rendering on chart ─────────────────────────────────── */
.tp-sl-rect.preview-rect {
  stroke-dasharray: 5,3;
  opacity: 0.85;
}

.preview-entry-line {
  stroke: #fff;
  stroke-width: 1;
  stroke-dasharray: 4,4;
  opacity: 0.6;
  pointer-events: none;
}

.preview-tp-line {
  stroke: #26a69a;
  stroke-width: 1;
  stroke-dasharray: 4,4;
  opacity: 0.85;
  pointer-events: none;
}
.preview-sl-line {
  stroke: #ef5350;
  stroke-width: 1;
  stroke-dasharray: 4,4;
  opacity: 0.85;
  pointer-events: none;
}
/* Invisible fat hit-area on top of the preview TP/SL lines so they're easy
   to grab and drag without the visible line itself looking thick. */
.preview-hit-line {
  stroke: transparent;
  stroke-width: 12;
  cursor: ns-resize;
  pointer-events: stroke;
}

/* ── Order book wall readout / labels ─────────────────────────────────── */
.wall-readout {
  display: flex;
  gap: 1rem;
  font-size: 12px;
  font-family: monospace;
}
.wall-stat.bid { color: #26a69a; }
.wall-stat.ask { color: #ef5350; }
.wall-stat.depth-count { color: #888; }

.impact-readout { margin-top: -0.25rem; }
.wall-stat.impact-long { color: #26a69a; }
.wall-stat.impact-short { color: #ef5350; }

.sr-line.sr-bid-wall { stroke: #26a69a; stroke-width: 2; stroke-dasharray: 10,4; opacity: 0.9; }
.sr-line.sr-ask-wall { stroke: #ef5350; stroke-width: 2; stroke-dasharray: 10,4; opacity: 0.9; }

.wall-price-labels { pointer-events: none; }
.wall-price-label { font-size: 10px; font-weight: bold; font-family: monospace; }
.wall-price-label.bid { fill: #26a69a; }
.wall-price-label.ask { fill: #ef5350; }

/* ── Large trade markers (aggTrade) ───────────────────────────────────── */

/* ── Volume Profile Fixed Range tool ──────────────────────────────────── */
.candle.vp-target {
  cursor: crosshair;
}

/* ── Anchored VWAP tool ────────────────────────────────────────────────── */
.candle.avwap-target {
  cursor: crosshair;
}

/* ── Range Download tool ──────────────────────────────────────────────── */
.candle.range-download-target {
  cursor: crosshair;
}

.range-download-boxes { pointer-events: none; }

.range-dl-rect {
  fill: rgba(251,191,36,0.06);
  stroke: rgba(251,191,36,0.5);
  stroke-width: 1;
  stroke-dasharray: 4,3;
}

.range-dl-rect-preview {
  fill: rgba(251,191,36,0.12);
  stroke: rgba(251,191,36,0.7);
}

/* Invisible fat hit-area on each edge so a placed range box can be
   extended/shrunk after the fact, without needing to redraw it. */
.range-dl-edge-handle {
  stroke: transparent;
  stroke-width: 10;
  cursor: ew-resize;
  pointer-events: stroke;
}

.range-dl-summary-label {
  fill: rgba(255,255,255,0.6);
  font-size: 10px;
  font-family: monospace;
}

.range-dl-close-btn {
  fill: rgba(255,255,255,0.4);
  font-size: 10px;
  font-family: monospace;
  cursor: pointer;
  pointer-events: all;
}
.range-dl-close-btn:hover { fill: #ef5350; }

.range-dl-download-btn {
  fill: #fbbf24;
  font-size: 11px;
  font-weight: bold;
  font-family: monospace;
  cursor: pointer;
  pointer-events: all;
}
.range-dl-download-btn:hover { fill: #fde68a; }

.range-dl-analyze-btn {
  fill: #60a5fa;
  font-size: 11px;
  font-weight: bold;
  font-family: monospace;
  cursor: pointer;
  pointer-events: all;
}
.range-dl-analyze-btn:hover { fill: #93c5fd; }

/* ── Range Investigate tool ───────────────────────────────────────────── */
.candle.range-investigate-target {
  cursor: crosshair;
}

.range-investigate-boxes { pointer-events: none; }

.range-inv-rect {
  fill: rgba(167,139,250,0.06);
  stroke: rgba(167,139,250,0.55);
  stroke-width: 1;
  stroke-dasharray: 4,3;
}

.range-inv-rect-preview {
  fill: rgba(167,139,250,0.12);
  stroke: rgba(167,139,250,0.75);
}

.range-inv-edge-handle {
  stroke: transparent;
  stroke-width: 10;
  cursor: ew-resize;
  pointer-events: stroke;
}

.range-inv-summary-label {
  fill: rgba(255,255,255,0.6);
  font-size: 10px;
  font-family: monospace;
}

.range-inv-close-btn {
  fill: rgba(255,255,255,0.4);
  font-size: 10px;
  font-family: monospace;
  cursor: pointer;
  pointer-events: all;
}
.range-inv-close-btn:hover { fill: #ef5350; }

.range-inv-investigate-btn {
  fill: #a78bfa;
  font-size: 11px;
  font-weight: bold;
  font-family: monospace;
  cursor: pointer;
  pointer-events: all;
}
.range-inv-investigate-btn:hover { fill: #c4b5fd; }

.range-inv-result-range-btn {
  fill: #fbbf24;
  font-size: 11px;
  font-weight: bold;
  font-family: monospace;
  cursor: pointer;
  pointer-events: all;
}
.range-inv-result-range-btn:hover { fill: #fcd34d; }
.range-inv-result-range-btn-active { fill: #fde68a; }

.range-inv-result-rect {
  fill: rgba(251,191,36,0.07);
  stroke: rgba(251,191,36,0.55);
  stroke-width: 1;
  stroke-dasharray: 2,2;
}

.range-inv-result-rect-preview {
  fill: rgba(251,191,36,0.14);
  stroke: rgba(251,191,36,0.8);
}

.range-inv-result-label {
  fill: rgba(251,191,36,0.75);
  font-size: 10px;
  font-family: monospace;
}

/* ── Summarize Movement tool ─────────────────────────────────────────────── */
.candle.summarize-target {
  cursor: crosshair;
}

.summarize-boxes { pointer-events: none; }

.summarize-rect {
  fill: rgba(45,212,191,0.06);
  stroke: rgba(45,212,191,0.55);
  stroke-width: 1;
  stroke-dasharray: 4,3;
}

.summarize-rect-preview {
  fill: rgba(45,212,191,0.12);
  stroke: rgba(45,212,191,0.75);
}

.summarize-edge-handle {
  stroke: transparent;
  stroke-width: 10;
  cursor: ew-resize;
  pointer-events: stroke;
}

.summarize-label {
  fill: rgba(255,255,255,0.6);
  font-size: 10px;
  font-family: monospace;
}

.summarize-close-btn {
  fill: rgba(255,255,255,0.4);
  font-size: 10px;
  font-family: monospace;
  cursor: pointer;
  pointer-events: all;
}
.summarize-close-btn:hover { fill: #ef5350; }

.summarize-btn {
  fill: #2dd4bf;
  font-size: 11px;
  font-weight: bold;
  font-family: monospace;
  cursor: pointer;
  pointer-events: all;
}
.summarize-btn:hover { fill: #5eead4; }

.volume-profiles { pointer-events: none; }

.vp-range-rect {
  fill: rgba(100,149,237,0.06);
  stroke: rgba(100,149,237,0.4);
  stroke-width: 1;
  stroke-dasharray: 4,3;
}

.vp-range-rect-preview {
  fill: rgba(100,149,237,0.1);
  stroke: rgba(100,149,237,0.6);
}

/* Invisible fat hit-area on each edge so a placed profile's period can be
   extended/shrunk after the fact, without needing to redraw it. */
.vp-edge-handle {
  stroke: transparent;
  stroke-width: 10;
  cursor: ew-resize;
  pointer-events: stroke;
}

.vp-row {
  opacity: 0.55;
}

.vp-row.vp-buy { fill: #26a69a; }
.vp-row.vp-sell { fill: #ef5350; }
.vp-preview-row { opacity: 0.35; }

.vp-poc-line {
  stroke: #fbbf24;
  stroke-width: 1.5;
  stroke-dasharray: 6,3;
  opacity: 0.9;
}

.vp-poc-label {
  fill: #fbbf24;
  font-size: 10px;
  font-weight: bold;
  font-family: monospace;
}

.vp-summary-label {
  fill: rgba(255,255,255,0.6);
  font-size: 10px;
  font-family: monospace;
}

.vp-oi-label {
  font-size: 10px;
  font-family: monospace;
}

.vp-oi-up { fill: #26a69a; }
.vp-oi-down { fill: #ef5350; }
.vp-oi-neutral { fill: rgba(255,255,255,0.45); }

.vp-bias-label {
  font-size: 10px;
  font-family: monospace;
  font-weight: 600;
  text-transform: uppercase;
}

.vp-bias-long { fill: #26a69a; }
.vp-bias-short { fill: #ef5350; }
.vp-bias-neutral { fill: rgba(255,255,255,0.45); }

.vp-stats-label {
  font-size: 10px;
  font-family: monospace;
  font-weight: 600;
}

.vp-stats-buy { fill: #26a69a; }
.vp-stats-sell { fill: #ef5350; }
.vp-stats-sep { fill: rgba(255,255,255,0.4); }

/* ── FRVP confluence analysis modal ──────────────────────────────────────
   NOTE: DialogComponent renders on a white background, so all text/border
   colors here are dark-on-light rather than the light-on-dark theme used
   by the rest of this component. ────────────────────────────────────── */
.frvp-analysis {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 2px 12px;
  color: #2a2a2a;
  font-size: 13px;
}

.frvp-analysis-empty {
  padding: 24px;
  color: rgba(0,0,0,0.5);
  font-size: 13px;
  text-align: center;
}

.frvp-analysis-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: rgba(0,0,0,0.6);
}

.frvp-bias-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: rgba(0,0,0,0.03);
}

.frvp-bias-label {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 1px;
}

.frvp-bias-confidence {
  font-size: 15px;
  font-weight: 600;
}

.frvp-bias-strength {
  font-weight: 400;
  color: rgba(0,0,0,0.6);
}

.frvp-bias-caveat {
  font-size: 11px;
  color: rgba(0,0,0,0.5);
  font-style: italic;
}

.frvp-bias-long { border-color: rgba(38,166,154,0.5); }
.frvp-bias-long .frvp-bias-label { color: #1e8e7f; }
.frvp-bias-short { border-color: rgba(239,83,80,0.5); }
.frvp-bias-short .frvp-bias-label { color: #d6392f; }
.frvp-bias-neutral { border-color: rgba(0,0,0,0.2); }
.frvp-bias-neutral .frvp-bias-label { color: rgba(0,0,0,0.55); }

.frvp-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #111;
}

.frvp-reason-list, .frvp-warning-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.frvp-warning-list { color: #92620a; }

.frvp-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.frvp-badge {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #ccc;
  background: rgba(0,0,0,0.04);
  font-size: 12px;
  white-space: nowrap;
  color: #2a2a2a;
}

.frvp-pattern-explanation, .frvp-hist-unavailable {
  margin: 0;
  color: rgba(0,0,0,0.7);
}

.frvp-zone-detail {
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 6px;
  padding: 6px 10px;
}

.frvp-zone-detail summary {
  cursor: pointer;
  font-size: 12px;
  color: #2a2a2a;
}

.frvp-zone-body {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(0,0,0,0.75);
}

.frvp-hit { color: #1e8e7f; }
.frvp-miss { color: #d6392f; }

/* ── Range Download scalp analysis dialog ────────────────────────────── */
.range-analysis {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 2px 12px;
  color: #2a2a2a;
  font-size: 13px;
}

.range-analysis-empty {
  padding: 24px;
  color: rgba(0,0,0,0.5);
  font-size: 13px;
  text-align: center;
}

.range-analysis-error { color: #d6392f; }

.range-analysis-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: rgba(0,0,0,0.6);
}

.range-bias-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: rgba(0,0,0,0.03);
}

.range-bias-label {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 1px;
}

.range-bias-confidence {
  font-size: 15px;
  font-weight: 600;
}

.range-bias-caveat {
  font-size: 11px;
  color: rgba(0,0,0,0.5);
  font-style: italic;
}

.range-bias-long { border-color: rgba(38,166,154,0.5); }
.range-bias-long .range-bias-label { color: #1e8e7f; }
.range-bias-short { border-color: rgba(239,83,80,0.5); }
.range-bias-short .range-bias-label { color: #d6392f; }
.range-bias-neutral { border-color: rgba(0,0,0,0.2); }
.range-bias-neutral .range-bias-label { color: rgba(0,0,0,0.55); }

.range-trade-card {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px 16px;
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid #ddd;
  background: rgba(0,0,0,0.02);
}

.range-trade-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  color: #2a2a2a;
}

.range-trade-label {
  color: rgba(0,0,0,0.55);
}

.range-entry-quality { font-weight: 600; }
.range-eq-very_good, .range-eq-good { color: #1e8e7f; }
.range-eq-fair { color: #92620a; }
.range-eq-poor, .range-eq-extended { color: #d6392f; }

.range-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #111;
}

.range-inv-download-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid #ddd;
  background: rgba(0,0,0,0.02);
  flex-wrap: wrap;
}

.range-inv-download-btn {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid rgba(167,139,250,0.6);
  background: #a78bfa;
  color: #1a1a1a;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.range-inv-download-btn:hover { background: #c4b5fd; }

.range-inv-download-note {
  font-size: 12px;
  color: rgba(0,0,0,0.55);
  flex: 1;
  min-width: 200px;
}

.range-thesis {
  margin: 0;
  color: rgba(0,0,0,0.8);
}

.range-reason-list, .range-warning-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #2a2a2a;
}

.range-warning-list { color: #92620a; }

.range-position-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: rgba(0,0,0,0.02);
}

.range-position-long { border-color: rgba(38,166,154,0.5); }
.range-position-short { border-color: rgba(239,83,80,0.5); }

.range-position-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.range-position-side {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #111;
}

.range-position-alignment {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #ccc;
}
.range-align-aligned { color: #1e8e7f; border-color: rgba(38,166,154,0.5); }
.range-align-opposed { color: #d6392f; border-color: rgba(239,83,80,0.5); }
.range-align-neutral { color: rgba(0,0,0,0.55); }

.range-position-confidence {
  font-size: 32px;
  font-weight: 700;
  color: #111;
}

.range-position-confidence-label {
  font-size: 12px;
  font-weight: 400;
  color: rgba(0,0,0,0.5);
  margin-left: 8px;
}

.range-position-thesis {
  margin: 0;
  color: rgba(0,0,0,0.75);
  font-size: 13px;
}

/* ── Range Investigate dialog ─────────────────────────────────────────── */
.investigate-driver-label {
  font-size: 20px;
  letter-spacing: 0.5px;
}

.investigate-driver-organic_flow { border-color: rgba(38,166,154,0.5); }
.investigate-driver-organic_flow .investigate-driver-label { color: #1e8e7f; }

.investigate-driver-squeeze_liquidation { border-color: rgba(239,83,80,0.5); }
.investigate-driver-squeeze_liquidation .investigate-driver-label { color: #d6392f; }

.investigate-driver-whale_single_trade { border-color: rgba(167,139,250,0.6); }
.investigate-driver-whale_single_trade .investigate-driver-label { color: #7c3aed; }

.investigate-driver-thin_liquidity_noise { border-color: rgba(251,191,36,0.6); }
.investigate-driver-thin_liquidity_noise .investigate-driver-label { color: #92620a; }

.investigate-driver-unclear { border-color: rgba(0,0,0,0.2); }
.investigate-driver-unclear .investigate-driver-label { color: rgba(0,0,0,0.55); }

.investigate-flow-confirms { color: #1e8e7f; font-weight: 600; }
.investigate-flow-absorption { color: #1e8e7f; font-weight: 600; }
.investigate-flow-contradicts { color: #d6392f; font-weight: 600; }
.investigate-flow-neutral { color: rgba(0,0,0,0.55); }

.investigate-prediction-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: rgba(0,0,0,0.02);
}

.investigate-verdict-continuation { border-color: rgba(38,166,154,0.5); }
.investigate-verdict-pullback { border-color: rgba(251,191,36,0.6); }
.investigate-verdict-reversal { border-color: rgba(239,83,80,0.5); }

.investigate-prediction-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.investigate-prediction-verdict {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #111;
}

.investigate-prediction-confidence {
  font-size: 12px;
  font-weight: 600;
  color: rgba(0,0,0,0.6);
}

.investigate-prediction-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.investigate-prediction-bar-row {
  display: grid;
  grid-template-columns: 90px 1fr 40px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.investigate-prediction-bar-label {
  color: rgba(0,0,0,0.6);
}

.investigate-prediction-bar-track {
  height: 8px;
  border-radius: 4px;
  background: rgba(0,0,0,0.08);
  overflow: hidden;
}

.investigate-prediction-bar-fill {
  height: 100%;
  border-radius: 4px;
}

.investigate-bar-continuation { background: #26a69a; }
.investigate-bar-pullback { background: #fbbf24; }
.investigate-bar-reversal { background: #ef5350; }

.investigate-prediction-bar-value {
  text-align: right;
  font-weight: 600;
  color: #2a2a2a;
}

.investigate-invalidation {
  margin: 0;
  font-size: 12px;
  color: rgba(0,0,0,0.55);
  font-style: italic;
}

.frvp-narrative p {
  margin: 0;
  padding: 10px 12px;
  border-radius: 4px;
  background: rgba(0,0,0,0.03);
  color: rgba(0,0,0,0.8);
  font-size: 12px;
  line-height: 1.5;
}

.vp-close-btn {
  fill: #ef5350;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  pointer-events: all;
}

.vp-download-btn {
  fill: #60a5fa;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.volume-profile:hover .vp-download-btn {
  opacity: 1;
  pointer-events: all;
}

.vp-close-btn:hover {
  fill: #ff8a80;
}

.vp-nudge-btn-bg {
  fill: rgba(255,255,255,0.08);
  stroke: rgba(255,255,255,0.2);
  stroke-width: 1;
  cursor: pointer;
  pointer-events: all;
}

.vp-nudge-btn-bg:hover {
  fill: rgba(96,165,250,0.35);
  stroke: #60a5fa;
}

.vp-nudge-btn-label {
  fill: rgba(255,255,255,0.85);
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  pointer-events: none;
}

/* ── Add price line dialog ────────────────────────────────────────────────
   NOTE: DialogComponent renders on a white background, same as the FRVP /
   Range Download dialogs above — dark-on-light, not this file's usual
   light-on-dark theme. ─────────────────────────────────────────────────── */
.line-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 2px 12px;
}

.line-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #2a2a2a;
}

.line-dialog-input {
  padding: 8px 10px;
  border: 1px solid rgba(0,0,0,0.18);
  border-radius: 6px;
  font-size: 14px;
  color: #1a1a1a;
  background: #fff;
}

.line-dialog-input:focus {
  outline: none;
  border-color: #42a5f5;
}

.line-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.line-dialog-btn {
  padding: 7px 16px;
  border-radius: 6px;
  border: 1px solid rgba(0,0,0,0.15);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.line-dialog-btn-cancel {
  background: #fff;
  color: #2a2a2a;
}
.line-dialog-btn-cancel:hover {
  background: #f2f2f2;
}

.line-dialog-btn-confirm {
  background: #42a5f5;
  border-color: #42a5f5;
  color: #fff;
}
.line-dialog-btn-confirm:hover {
  background: #2f95ea;
}

/* ── Freeform rectangle draw tool ─────────────────────────────────────── */
.draw-rect {
  fill: rgba(255, 213, 79, 0.12);
  stroke: #ffd54f;
  stroke-width: 1.5;
  pointer-events: all;
  cursor: move;
}
.draw-rect-preview {
  stroke-dasharray: 4, 3;
  pointer-events: none;
  cursor: default;
}
/* Invisible fat hit-areas along each edge so the rectangle can be resized
   after placement — dragging an edge adjusts just that side (horizontal
   edges → price bounds, vertical edges → x/width) without moving the rest
   of the box. */
.draw-rect-edge {
  stroke: transparent;
  stroke-width: 10;
  pointer-events: stroke;
}
.draw-rect-edge-v { cursor: ew-resize; }
.draw-rect-edge-h { cursor: ns-resize; }
.draw-rect-close {
  fill: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  cursor: pointer;
  pointer-events: all;
}
.draw-rect-close:hover {
  fill: #ff8a80;
}

/* ── Horizontal price line tool ───────────────────────────────────────── */
.price-line {
  stroke: #42a5f5;
  stroke-width: 1.25;
  stroke-dasharray: 5, 3;
  pointer-events: none;
}
.price-line-hit {
  stroke: transparent;
  stroke-width: 10;
  pointer-events: stroke;
  cursor: ns-resize;
}
.price-line-label {
  fill: #42a5f5;
  font-size: 11px;
  font-family: monospace;
  font-weight: 600;
  pointer-events: none;
}
.price-line-close {
  fill: rgba(255, 255, 255, 0.4);
  font-size: 10px;
  cursor: pointer;
  pointer-events: all;
}
.price-line-close:hover {
  fill: #ff8a80;
}

/* ── Price range tool ─────────────────────────────────────────────────── */
.price-range-box {
  stroke-width: 1.5;
  pointer-events: none;
}
.price-range-preview {
  stroke-dasharray: 4, 3;
}
.price-range-up {
  fill: rgba(38, 166, 154, 0.14);
  stroke: #26a69a;
}
.price-range-down {
  fill: rgba(239, 83, 80, 0.14);
  stroke: #ef5350;
}
.price-range-label {
  font-size: 11px;
  font-family: monospace;
  font-weight: 700;
  pointer-events: none;
}
.price-range-up-text { fill: #26a69a; }
.price-range-down-text { fill: #ef5350; }
.price-range-close {
  fill: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  cursor: pointer;
  pointer-events: all;
}
.price-range-close:hover {
  fill: #ff8a80;
}

/* ── Anchored VWAP overlay ────────────────────────────────────────────── */
.anchored-vwaps { pointer-events: none; }
.avwap-group { pointer-events: none; }

.avwap-mid-line {
  fill: none;
  stroke-width: 1.75;
  opacity: 0.95;
}
.avwap-band-line {
  fill: none;
  stroke-width: 1;
  stroke-dasharray: 4, 3;
  opacity: 0.6;
}
.avwap-band-fill {
  stroke: none;
  opacity: 0.07;
}
.avwap-anchor-dot {
  stroke: #0d0d0d;
  stroke-width: 1;
}
.avwap-anchor-close {
  fill: rgba(255, 255, 255, 0.55);
  font-size: 10px;
  cursor: pointer;
  pointer-events: all;
  user-select: none;
}
.avwap-anchor-close:hover {
  fill: #ff8a80;
}

.avwap-end-guide {
  stroke-width: 1;
  stroke-dasharray: 2, 2;
  opacity: 0.5;
  pointer-events: none;
}
.avwap-end-handle {
  cursor: ew-resize;
  pointer-events: all;
  stroke-width: 1.5;
}
.avwap-end-handle-open {
  fill: rgba(0, 0, 0, 0.3);
  opacity: 0.75;
}
.avwap-end-handle-pinned {
  stroke: #0d0d0d;
  opacity: 0.95;
}
.avwap-end-handle-dragging {
  opacity: 1;
  filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.6));
}

/* ── Backtest playback controls ───────────────────────────────────────── */
.backtest-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.backtest-nav-btn,
.backtest-stop-btn {
  background: #1a1a1a;
  border: 1px solid #444;
  color: #ddd;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.backtest-nav-btn:hover:not(:disabled),
.backtest-stop-btn:hover {
  border-color: #26a69a;
  color: #26a69a;
}
.backtest-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.backtest-stop-btn {
  border-color: #ef5350;
  color: #ef5350;
}
.backtest-stop-btn:hover {
  background: rgba(239, 83, 80, 0.15);
}
.backtest-index-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  font-family: monospace;
}
.backtest-place-error {
  font-size: 12px;
  color: #ef5350;
}

/* ── Backtest long/short position markers ────────────────────────────── */
.backtest-entry-line {
  stroke: rgba(255, 255, 255, 0.5);
  stroke-width: 1;
  stroke-dasharray: 3, 3;
  pointer-events: none;
}
.backtest-tp-line {
  stroke: #26a69a;
  stroke-width: 1;
  stroke-dasharray: 3, 3;
  opacity: 0.8;
  pointer-events: none;
}
.backtest-sl-line {
  stroke: #ef5350;
  stroke-width: 1;
  stroke-dasharray: 3, 3;
  opacity: 0.8;
  pointer-events: none;
}
/* Invisible fat hit-area drawn on top of each visible line so it's easy to
   grab and drag without the line itself looking thick. */
.backtest-hit-line {
  stroke: transparent;
  stroke-width: 12;
  cursor: ns-resize;
  pointer-events: stroke;
}
.backtest-move-handle {
  fill: #fff;
  stroke: #000;
  stroke-width: 1;
  cursor: move;
  pointer-events: all;
}
.backtest-move-handle:hover { fill: #64b5f6; }
.backtest-position-label {
  font-size: 11px;
  font-weight: bold;
  pointer-events: none;
}
.backtest-position-label.label-long { fill: #26a69a; }
.backtest-position-label.label-short { fill: #ef5350; }
.backtest-position-close {
  fill: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  cursor: pointer;
  pointer-events: all;
}
.backtest-position-close:hover {
  fill: #ff8a80;
}

/* ── Zone-full marker (candleData.zoneInhabitantCount === 24) ────────────── */
.zone-full-lines { pointer-events: none; }
.zone-full-line {
  stroke: #ffa726;
  stroke-width: 1.5;
  stroke-dasharray: 6, 5;
  opacity: 0.35;
}

/* ── Volume bars (bottom-of-chart overlay) ────────────────────────────── */
.volume-bars { pointer-events: none; }
.volume-bar { opacity: 0.35; }
.volume-bar.bull { fill: #26a69a; }
.volume-bar.bear { fill: #ef5350; }

.oi-bars { pointer-events: none; }
.oi-bar { fill: #ffd60a; opacity: 0.45; }

.movement-bars { pointer-events: none; }
.movement-bar { cursor: pointer; pointer-events: all; opacity: 0.85; }
.movement-bar:hover { opacity: 1; }
.movement-bar-inflow { fill: #26a69a; }
.movement-bar-outflow { fill: #ef5350; }
.movement-panel-label { fill: rgba(255,255,255,0.5); font-size: 10px; font-family: monospace; pointer-events: none; }
.movement-panel-label-error { fill: #ef5350; }

.movement-detail-body { color: #fff; }
.movement-detail-meta { display: flex; gap: 1rem; font-size: 12px; color: #999; margin-bottom: 1rem; flex-wrap: wrap; }
.movement-detail-summary { display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
.movement-detail-summary-item { font-size: 13px; font-weight: 600; padding: 6px 10px; border-radius: 4px; background: #1a1a1a; border: 1px solid #333; color: #ddd; }
.movement-inflow-total { color: #26a69a; border-color: #26a69a; }
.movement-outflow-total { color: #ef5350; border-color: #ef5350; }
.movement-detail-list { display: flex; flex-direction: column; gap: 6px; }
.movement-detail-row { display: flex; align-items: center; gap: 10px; font-size: 12px; font-family: monospace; padding: 6px 8px; border-radius: 4px; background: #1a1a1a; border-left: 2px solid #333; flex-wrap: wrap; }
.movement-row-inflow { border-left-color: #26a69a; }
.movement-row-outflow { border-left-color: #ef5350; }
.movement-detail-amount { color: #fff; font-weight: 600; min-width: 130px; }
.movement-detail-addr { color: #999; }
.movement-detail-time { color: #666; margin-left: auto; }
.movement-detail-tx { color: #64b5f6; text-decoration: none; }
.movement-detail-tx:hover { text-decoration: underline; }
.movement-detail-empty { color: #999; font-size: 13px; padding: 1rem 0; text-align: center; }

/* ── Summarize Movement dialog ───────────────────────────────────────────── */
.movement-summary-body { color: #fff; }
.range-meta-row { display: flex; gap: 1rem; font-size: 12px; color: #999; margin-bottom: 1rem; flex-wrap: wrap; font-family: monospace; }
.movement-summary-totals { margin-bottom: 1rem; }

.movement-summary-chart { display: flex; flex-direction: column; gap: 10px; }

.movement-summary-bar-row {
  display: grid;
  grid-template-columns: 90px 1fr 90px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-family: monospace;
}

.movement-summary-bar-label { color: #999; }

.movement-summary-bar-track {
  height: 10px;
  border-radius: 3px;
  background: #1a1a1a;
  overflow: hidden;
}

.movement-summary-bar-fill { height: 100%; }
.movement-summary-bar-inflow { background: #26a69a; }
.movement-summary-bar-outflow { background: #ef5350; }

.movement-summary-bar-value { color: #ddd; font-weight: 600; text-align: right; }

.oi-panel-label { fill: rgba(255, 214, 10, 0.55); font-size: 10px; font-family: monospace; pointer-events: none; }
.oi-panel-label-error { fill: #ff8a80; }

.indicator-panel-bg { fill: rgba(255, 255, 255, 0.015); pointer-events: none; }
.indicator-panel-separator { stroke: rgba(255, 255, 255, 0.1); stroke-width: 1; pointer-events: none; }

.ls-ratio-bars { pointer-events: none; }
.ls-ratio-bar { opacity: 0.65; }
.ls-ratio-bar-long { fill: #26a69a; }
.ls-ratio-bar-short { fill: #ef5350; }
.ls-ratio-centerline { stroke: rgba(255, 255, 255, 0.25); stroke-width: 1; stroke-dasharray: 3, 3; }
.ls-ratio-panel-label { fill: rgba(255, 255, 255, 0.4); font-size: 10px; font-family: monospace; pointer-events: none; }
.ls-ratio-panel-label-error { fill: #ff8a80; }
.volume-panel-label { fill: rgba(255,255,255,0.35); font-size: 10px; font-family: monospace; pointer-events: none; }

/* ── Live indicator ───────────────────────────────────────────────────── */
.live-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,0.06);
  letter-spacing: 0.4px;
}

.live-indicator:last-child {
  margin-left: auto;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.live-indicator.connected   { color: #26a69a; }
.live-indicator.connecting  { color: #fbbf24; }
.live-indicator.disconnected{ color: #888; }
.live-indicator.error       { color: #ef5350; }

.live-indicator.connected   .live-dot { background: #26a69a; box-shadow: 0 0 6px #26a69a; animation: pulse 1.5s infinite; }
.live-indicator.connecting  .live-dot { background: #fbbf24; }
.live-indicator.disconnected .live-dot{ background: #555; }
.live-indicator.error       .live-dot { background: #ef5350; }

.candle-countdown { color: rgba(255,255,255,0.65); font-family: monospace; font-variant-numeric: tabular-nums; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

/* ── Live price label on axis ─────────────────────────────────────────── */
.live-price-label-group { pointer-events: none; }

.live-price-bg { opacity: 0.9; }
.live-price-bg.bull-bg { fill: #26a69a; }
.live-price-bg.bear-bg { fill: #ef5350; }

.live-price-text {
  fill: #fff;
  font-size: 10px;
  font-weight: bold;
  text-anchor: middle;
  font-family: monospace;
}

/* ── Pre-Trade Checklist Modal (foreignObject inside the SVG) ───────────── */
.order-checklist-group { pointer-events: auto; }
.order-checklist {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  font-family: sans-serif;
  color: #ddd;
  overflow: hidden;
  user-select: none;
}
.order-checklist-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: #222;
  border-bottom: 1px solid #333;
  font-weight: 600;
  font-size: 13px;
  color: #26a69a;
  cursor: move;
}
.order-checklist-close {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.order-checklist-close:hover { color: #fff; }
.order-checklist-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  user-select: text;
}
.order-checklist-section-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.order-checklist-section.buy .order-checklist-section-title { color: #26a69a; }
.order-checklist-section.sell .order-checklist-section-title { color: #ef5350; }
.order-checklist-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.order-checklist-item input { margin-top: 2px; cursor: pointer; }
.order-checklist-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #333;
  background: #1a1a1a;
}
.order-checklist-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid #333;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: #2a2a2a;
  color: #ddd;
}
.order-checklist-btn.cancel:hover { background: #333; }
.order-checklist-btn.confirm { background: #26a69a; border-color: #26a69a; color: #0a0a0a; }
.order-checklist-btn.confirm:not(:disabled):hover { background: #2fc4b5; }
.order-checklist-btn.confirm:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Live candle outline ──────────────────────────────────────────────── */
.candle.live .body {
  stroke-dasharray: 3 2;
  opacity: 0.95;
}

/* ── Rest of original styles ──────────────────────────────────────────── */
.chart-container {
  position: relative;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
  overflow-y: hidden;
  user-select: none;
}

.candles-svg { display: block; }

.crosshair { pointer-events: none; }
.crosshair-line { stroke: rgba(255,255,255,0.3); stroke-width: 1; stroke-dasharray: 4,4; }
.crosshair-line.horizontal { opacity: 0.6; }
.crosshair-line.vertical   { opacity: 0.6; }

.zone-rect { fill: rgba(128,128,128,0.12); stroke: rgba(255,255,255,0.1); stroke-width: 1; }
.zone-rect.zone-active { fill: rgba(100,149,237,0.2); stroke: rgba(100,149,237,0.4); stroke-width: 2; }

.zone-mid-lines { pointer-events: none; }
.mid-line { stroke: rgba(255,255,255,0.3); stroke-width: 1.5; stroke-dasharray: 4,4; }

.support-resistance-lines { pointer-events: none; }
.sr-line { stroke-width: 2; stroke-dasharray: 6,3; }
.sr-line.sr-support { stroke: #ef5350; opacity: 0.8; }
.sr-line.sr-resistance { stroke: #26a69a; opacity: 0.8; }
.sr-line.sr-breakthrough_support { stroke: #ef5350; opacity: 1; stroke-width: 1; stroke-dasharray: 8,4; }
.sr-line.sr-breakthrough_resistance { stroke: #26a69a; opacity: 1; stroke-width: 1; stroke-dasharray: 8,4; }

.tp-sl-boxes { pointer-events: none; }
.tp-sl-rect { stroke-width: 2; }
.tp-sl-rect.box-tp { fill: rgba(38,166,154,0.3); stroke: #26a69a; }
.tp-sl-rect.box-tp.status-open { fill: rgba(38,166,154,0.2); }
.tp-sl-rect.box-tp.status-win_long, .tp-sl-rect.box-tp.status-win_short { fill: rgba(38,166,154,0.4); }
.tp-sl-rect.box-tp.status-loss_long, .tp-sl-rect.box-tp.status-loss_short { fill: rgba(38,166,154,0.15); }
.tp-sl-rect.box-sl { fill: rgba(239,83,80,0.3); stroke: #ef5350; }
.tp-sl-rect.box-sl.status-open { fill: rgba(239,83,80,0.2); }
.tp-sl-rect.box-sl.status-win_long, .tp-sl-rect.box-sl.status-win_short { fill: rgba(239,83,80,0.15); }
.tp-sl-rect.box-sl.status-loss_long, .tp-sl-rect.box-sl.status-loss_short { fill: rgba(239,83,80,0.4); }

.volume-spike-line { stroke: #fb923c; opacity: 0.8; pointer-events: none; }

.long-potential  { stroke: #42f12b; fill: #42f12b; opacity: 0.8; pointer-events: none; }
.short-potential { stroke: #ff2323; fill: #ff2323; opacity: 0.8; pointer-events: none; }
.ema-line { stroke: #ffffff; opacity: 0.7; pointer-events: none; }
.ma200-line { stroke: orange; opacity: 0.85; pointer-events: none; }
.ma100-line { stroke: dodgerblue; opacity: 0.85; pointer-events: none; }

.cross-tf-ema-line { opacity: 0.85; pointer-events: none; }
.cross-tf-ema-label { font-size: 10px; font-family: monospace; font-weight: 600; pointer-events: none; }

.multi-tf-candles { }
.multi-tf-candle { opacity: 0.4; }
.multi-tf-candle.bull { opacity: 0.5; }
.multi-tf-candle.bear { opacity: 0.32; }
.multi-tf-candle.partial { opacity: 0.65; }
.multi-tf-wick { stroke-width: 1; pointer-events: none; }
.multi-tf-body { stroke-width: 1; pointer-events: none; }
.multi-tf-body-partial { stroke-dasharray: 3,2; }

/* Invisible fat hit-area on the right edge — drag to scrub the bar's OHLC
   back to an earlier point in its span, double-click to reset. */
.multi-tf-edge-handle {
  stroke: transparent;
  stroke-width: 10;
  cursor: ew-resize;
  pointer-events: stroke;
}

.multi-tf-partial-label {
  font-size: 9px;
  font-family: monospace;
  font-weight: 600;
  pointer-events: none;
}

/* Prepended lead-in candles — full opacity, same visual weight as a base
   candle so they read as real (if coarser) price action, not a faded overlay. */
.multi-tf-prepend-candles { }
.multi-tf-prepend-candle { opacity: 0.9; }
.multi-tf-prepend-wick { stroke-width: 1; pointer-events: none; }
.multi-tf-prepend-body { stroke-width: 1; pointer-events: none; }
.multi-tf-prepend-label {
  font-size: 9px;
  font-family: monospace;
  font-weight: 600;
  pointer-events: none;
  text-anchor: start;
}

.grid-line { stroke: rgba(255,255,255,0.05); stroke-width: 1; }

.price-label { fill: rgba(255,255,255,0.6); font-size: 11px; text-anchor: end; user-select: none; }
.price-label:hover { fill: rgba(255,255,255,0.9); font-weight: bold; }

.zone-label-text { fill: rgba(255,255,255,0.4); font-size: 10px; pointer-events: none; }

.candle { cursor: pointer; transition: opacity 0.15s ease; }
.candle:hover { opacity: 0.8; }
.candle.indecisive { opacity: 0.5; }

/* ── Volume-relative muting ───────────────────────────────────────────── */
.candle.muted { opacity: 0.15; }

.wick { stroke-width: 1; }
.candle.bull .wick { stroke: #26a69a; }
.candle.bear .wick { stroke: #ef5350; }
.body { stroke-width: 1; }
.candle.bull .body { fill: #26a69a; stroke: #26a69a; }
.candle.bear .body { fill: #ef5350; stroke: #ef5350; }

.volume-spike-indicator { pointer-events: none; }
.volume-spike-dot   { fill: #fbbf24; opacity: 0.9; }
.is-past-volume-good-dot { fill: #ffffff; opacity: 0.9; }
.is-change-high-dot { fill: #3bd1ff; opacity: 0.9; }
.price-move         { fill: #b130d1; opacity: 0.9; }

.support-resistance-dots { pointer-events: none; }
.sr-dot { fill: #808080; opacity: 0.3; transition: opacity 0.2s; }
.sr-dot.visible { opacity: 0.8; }

.modal-overlay { position: fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:1000; }
.modal-content { background:#1a1a1a; border:1px solid #333; border-radius:8px; max-width:600px; max-height:80vh; overflow-y:auto; box-shadow:0 10px 40px rgba(0,0,0,0.5); }
.modal-header { display:flex; justify-content:space-between; align-items:center; padding:1.5rem; border-bottom:1px solid #333; position:sticky; top:0; background:#1a1a1a; }
.modal-header h2 { margin:0; font-size:18px; color:#26a69a; }
.close-btn { background:none; border:none; color:#999; font-size:24px; cursor:pointer; padding:0; width:30px; height:30px; display:flex; align-items:center; justify-content:center; transition:color 0.2s; }
.close-btn:hover { color:#fff; }
.modal-body { padding:1.5rem; }
.candle-details { color:#fff; }
.detail-grid { display:flex; flex-direction:column; gap:1.5rem; }
.detail-section { border-left:2px solid #26a69a; padding-left:1rem; }
.detail-section h3 { margin:0 0 0.5rem 0; font-size:14px; color:#26a69a; }
.detail-item { display:flex; justify-content:space-between; margin-bottom:0.5rem; font-size:13px; }
.detail-item label { color:#999; min-width:120px; }
.detail-item span { color:#fff; font-family:monospace; font-weight:500; }
.side-badge, .status-badge { padding:2px 8px; border-radius:4px; font-size:12px; font-weight:bold; }
.side-badge.side-long { background:rgba(38,166,154,0.3); color:#26a69a; }
.side-badge.side-short { background:rgba(239,83,80,0.3); color:#ef5350; }
.status-badge { background:rgba(100,149,237,0.3); color:#64b5f6; }
.nested-section { margin-left:1rem; padding-left:1rem; border-left:1px solid #444; margin-top:0.75rem; margin-bottom:0.75rem; }
.nested-section h4 { margin:0 0 0.5rem 0; font-size:12px; color:#999; text-transform:uppercase; letter-spacing:0.5px; }
.detail-item.nested { margin-bottom:0.35rem; }
.detail-item.nested label { min-width:100px; font-size:12px; }

.volume-spike-label { font-size:11px; font-weight:bold; text-anchor:middle; }
.volume-spike-label.positive { fill:#26a69a; }
.volume-spike-label.negative { fill:#ef5350; }

.ob-marker { fill: red; }
.os-marker { fill: green; }

.atr-extensions { pointer-events: none; }
.atr-extension-rect { stroke:#808080; stroke-width:1; opacity:0.5; stroke-linecap:round; background:gray; }
.atr-extension-rect.is_not_1 { display:none; }

.pattern-track-indicators { pointer-events: none; }
.higher-low-indicator { opacity: 0.9; }
.hl-dot { fill:#42f12b; opacity:1; }
.lower-high-indicator { opacity: 0.9; }
.lh-dot { fill:#ff2323; opacity:1; }
.pattern-label { font-size:10px; font-weight:bold; text-anchor:middle; fill:#fff; opacity:0.8; }
.pattern-label:hover { opacity:1; font-size:11px; }
.weakening-indicator { pointer-events: none; }
.weakening-diamond { fill:#f59e0b; opacity:0.9; stroke:#fcd34d; stroke-width:1; }
</style>