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

      <button @click="showKeyLevels = true">show key levels</button>

      <button @click="showMaCrossing = true">See MA</button>

      <button @click="showAccumulationAnalysis = true">Accumulation Scan</button>

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
      <div class="live-indicator" :class="tradeWsStatus">
        <span class="live-dot" />
        <span class="live-label">Trades: {{ tradeWsStatusLabel }}</span>
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
      <button class="preview-panel-close" @click="clearPreview">×</button>
    </div>
    <div v-if="previewError" class="preview-error">{{ previewError }}</div>

    <div class="chart-container" ref="chartContainer" @wheel="handleZoom" @mousemove="handleMouseMove" @mouseleave="handleMouseLeave" @mousedown="handleChartMouseDown">
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
              'range-download-target': rangeDownloadModeActive
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

        <!-- Large Trade Markers (real-time aggTrade, notional above rolling average) -->
        <g class="large-trade-markers">
          <g v-for="marker in largeTradeMarkers" :key="`trade-${marker.id}`">
            <circle
              :cx="marker.x" :cy="marker.y" :r="marker.radius"
              :class="['large-trade-dot', marker.side === 'BUY' ? 'buy' : 'sell']"
            />
            <text
              :x="marker.x" :y="marker.y - marker.radius - 4"
              :class="['large-trade-label', marker.side === 'BUY' ? 'buy' : 'sell']"
            >
              {{ marker.label }}
            </text>
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

        <!-- Anchored VWAP tool overlay -->
        <g class="anchored-vwaps">
          <g
            v-for="avwap in anchoredVwapSeries"
            :key="`avwap-${avwap.id}`"
            class="avwap-group"
          >
            <!-- shaded band between upper/lower -->
            <polygon
              v-if="avwap.points.length > 1"
              :points="avwapBandPolygon(avwap.points)"
              class="avwap-band-fill"
              :style="{ fill: avwap.color }"
            />

            <!-- upper band -->
            <polyline
              v-if="avwap.points.length > 1"
              :points="avwapLinePoints(avwap.points, 'upper')"
              class="avwap-band-line"
              :style="{ stroke: avwap.color }"
            />

            <!-- lower band -->
            <polyline
              v-if="avwap.points.length > 1"
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
          :side="pendingSide"
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
</template>

<script setup lang="ts">
import type { CandleEntry, FuturesSymbol } from '@/core/interfaces';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
// NOTE: adjust this import path to wherever OrderMakerUtility actually lives in your project
import { OrderMakerUtility } from '@/utility/OrderMakerUtility';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import KeyLevelVisualizerComponent from './KeyLevelVisualizerComponent.vue';
import MACrossingVisualizerComponent from './MACrossingVisualizerComponent.vue';
import AccumulationAnalysisResultComponent from './AccumulationAnalysisResultComponent.vue';
import { getOpenInterestRateForRange, type OpenInterestRangeRate } from '@/utility/accumulationAnalysis.ts';
import { analyzeFrvps, type FrvpAnalysisResult, type FrvpZoneInput } from '@/utility/analyzeFrvps';
import { analyzeRange, type RangeAnalysisResult, type RangeAnalysisInput } from '@/utility/rangeAnalyze';
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

// ─── Binance aggTrade stream message shape ────────────────────────────────────
// wss://fstream.binance.com/ws/<symbol>@aggTrade
interface BinanceAggTradeMessage {
  e: 'aggTrade'
  E: number
  a: number   // aggregate trade id
  s: string
  p: string   // price
  q: string   // quantity
  f: number
  l: number
  T: number   // trade time
  m: boolean  // true => buyer is maker (i.e. taker was a seller)
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  candles: CandleEntry[]
  /** e.g. 'btcusdt' — must be lowercase for Binance stream name */
  symbol?: string
  /** Kline interval, must match the interval of the candles you're passing in */
  interval?: string
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
 * tool when it's armed, otherwise falls through to the existing chart-pan
 * behavior (which itself already yields to the Volume Profile tool).
 */
function handleChartMouseDown(event: MouseEvent) {
  if (rectModeActive.value) {
    startRectDraw(event)
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

/** Single mousedown entry point for a candle — routes to whichever click-driven tool is currently armed. */
function handleCandleMouseDown(index: number, event: MouseEvent) {
  if (avwapModeActive.value) {
    handleCandleMouseDownForAvwap(index, event)
    return
  }
  if (rangeDownloadModeActive.value) {
    handleCandleMouseDownForRangeDownload(index, event)
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
  disconnectTradeWebSocket()
}

function stopBacktest() {
  backtestActive.value = false
  connectWebSocket()
  connectDepthWebSocket()
  connectTradeWebSocket()
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
  const rawIndex = (x - 10 - candleWidth.value / 2) / (candleWidth.value + candleGap)
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

  // Profile is anchored just to the right of the selected range's last candle.
  const rightEdgeX = candleX(endIndex) + candleWidth.value / 2 + 4

  const rows = buckets.map(b => {
    const total = b.buyVolume + b.sellVolume
    const totalWidth = maxRowTotal > 0 ? (total / maxRowTotal) * VP_MAX_BAR_WIDTH : 0
    const buyWidth = total > 0 ? totalWidth * (b.buyVolume / total) : 0
    const sellWidth = totalWidth - buyWidth
    return {
      x: rightEdgeX,
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
  const totalVolume = buckets.reduce((s, b) => s + b.buyVolume + b.sellVolume, 0)

  return {
    startIndex,
    endIndex,
    leftX: candleX(startIndex) - candleWidth.value / 2,
    rightX: rightEdgeX + VP_MAX_BAR_WIDTH,
    rangeTop: priceToY(rangeHigh),
    rangeBottom: priceToY(rangeLow),
    rangeHighPrice: rangeHigh,
    rangeLowPrice: rangeLow,
    rows,
    pocY: priceToY(pocPrice),
    pocPrice,
    totalVolume,
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
 
  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg: BinanceKlineMessage = JSON.parse(event.data as string)
      
      if (msg.e !== 'kline') return
 
      const k = msg.k
      const o = parseFloat(k.o)
      const h = parseFloat(k.h)
      const l = parseFloat(k.l)
      const c = parseFloat(k.c)
      const v = parseFloat(k.v)
 
      
      // Guard: skip malformed frames — any NaN would collapse priceDelta to NaN
      if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) return
 
      const lastPropCandle = props.candles[props.candles.length - 1]
      if (!lastPropCandle) return
 
      if (k.t === lastPropCandle.openTime) {
        // Same bar as the last CLOSED candle we already have — this is just
        // an in-progress update to that same candle. Patch OHLC into a
        // shallow copy so all computed indicators (zones, SR, etc.) remain
        // intact. displayCandles() below will REPLACE the last candle with
        // this, not append it.
        liveCandle.value = {
          ...lastPropCandle,
          openTime: k.t,
          open:  o,
          high:  h,
          low:   l,
          close: c,
          volume: isNaN(v) ? lastPropCandle.volume : v,
        }
      } else if (k.t > lastPropCandle.openTime) {
        // The stream has rolled over to a genuinely new bar that isn't in
        // props.candles yet (parent hasn't caught up). This really is a new
        // candle — append it, but don't inherit analytic fields (support/
        // resistance, zones, candleData, etc.) from the old bar since those
        // don't apply to this new period.
        const { candleData: _omitCandleData, ...lastPropCandleWithoutAnalytics } = lastPropCandle
        liveCandle.value = {
          ...lastPropCandleWithoutAnalytics,
          openTime: k.t,
          open:  o,
          high:  h,
          low:   l,
          close: c,
          volume: isNaN(v) ? 0 : v,
          support: null,
          resistance: null,
          candleData: _omitCandleData
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

// ─── Trades (aggTrade) ────────────────────────────────────────────────────────
interface LargeTrade {
  id: number
  price: number
  notional: number
  side: 'BUY' | 'SELL'
  time: number
}

const TRADE_HISTORY_SIZE = 200
const MAX_LARGE_TRADES_DISPLAYED = 30
/** Trade notional must exceed the rolling average notional × this to be plotted */
const largeTradeMultiplier = ref<number>(3)
const tradeNotionalHistory: number[] = [] // plain array, not reactive — perf on high-frequency stream
const largeTrades = ref<LargeTrade[]>([])

const tradeWsStatus = ref<WsStatus>('connecting')
const tradeWsStatusLabel = computed(() => ({
  connecting:   'Connecting…',
  connected:    'Live',
  disconnected: 'Disconnected',
  error:        'Error',
}[tradeWsStatus.value]))

let tradeWs: WebSocket | null = null
let tradeReconnectTimer: ReturnType<typeof setTimeout> | null = null
let tradeReconnectDelay = 2_000

function connectTradeWebSocket() {
  if (tradeWs) {
    tradeWs.onclose = null
    tradeWs.close()
  }

  const streamName = `${props.symbol.toLowerCase()}@aggTrade`
  const url = `wss://fstream.binance.com/market/ws/${streamName}`

  tradeWsStatus.value = 'connecting'
  tradeWs = new WebSocket(url)

  tradeWs.onopen = () => {
    tradeWsStatus.value = 'connected'
    tradeReconnectDelay = 2_000
  }

  tradeWs.onmessage = (event: MessageEvent) => {
    try {
      const msg: BinanceAggTradeMessage = JSON.parse(event.data as string)
      if (msg.e !== 'aggTrade') return

      const price = parseFloat(msg.p)
      const qty = parseFloat(msg.q)
      if (isNaN(price) || isNaN(qty)) return

      const notional = price * qty
      const avgNotional = tradeNotionalHistory.length > 0
        ? tradeNotionalHistory.reduce((a, b) => a + b, 0) / tradeNotionalHistory.length
        : notional

      // Push to history AFTER computing avg so this trade doesn't skew its own comparison.
      tradeNotionalHistory.push(notional)
      if (tradeNotionalHistory.length > TRADE_HISTORY_SIZE) tradeNotionalHistory.shift()

      if (notional > avgNotional * largeTradeMultiplier.value) {
        largeTrades.value.push({
          id: msg.a,
          price,
          notional,
          side: msg.m ? 'SELL' : 'BUY', // m === true => buyer is maker => taker was the seller
          time: msg.T,
        })
        if (largeTrades.value.length > MAX_LARGE_TRADES_DISPLAYED) largeTrades.value.shift()
      }
    } catch {
      // malformed frame — ignore
    }
  }

  tradeWs.onerror = () => {
    tradeWsStatus.value = 'error'
  }

  tradeWs.onclose = () => {
    tradeWsStatus.value = 'disconnected'
    tradeReconnectTimer = setTimeout(() => {
      tradeReconnectDelay = Math.min(tradeReconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      connectTradeWebSocket()
    }, tradeReconnectDelay)
  }
}

function disconnectTradeWebSocket() {
  if (tradeReconnectTimer !== null) {
    clearTimeout(tradeReconnectTimer)
    tradeReconnectTimer = null
  }
  if (tradeWs) {
    tradeWs.onclose = null
    tradeWs.close()
    tradeWs = null
  }
}

function intervalToMs(interval: string): number {
  const unit = interval.slice(-1)
  const value = parseInt(interval.slice(0, -1), 10)
  const unitMs: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
  return (isNaN(value) ? 1 : value) * (unitMs[unit] ?? 60_000)
}

/**
 * Large trades rendered as dots positioned at (time-within-live-candle, price).
 * Radius scales gently with notional size (log scale) so very large trades
 * stand out without dominating the chart.
 */
const largeTradeMarkers = computed(() => {
  if (!liveCandle.value || displayCandles.value.length === 0) return []
  const lastIndex = displayCandles.value.length - 1
  const leftX = candleX(lastIndex) - candleWidth.value / 2
  const cellWidth = candleWidth.value + candleGap
  const intervalMs = intervalToMs(props.interval)
  const openTime = (liveCandle.value.openTime as number) ?? Date.now()

  return largeTrades.value.map(t => {
    const frac = Math.min(1, Math.max(0, (t.time - openTime) / intervalMs))
    return {
      ...t,
      x: leftX + frac * cellWidth,
      y: priceToY(t.price),
      radius: Math.min(14, 4 + Math.log10(t.notional / 1000 + 1) * 4),
      label: formatNotional(t.notional),
    }
  })
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

const previewMargin = ref<number>(5)
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

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => {
  scrollToRight()
  connectWebSocket()
  connectDepthWebSocket()
  connectTradeWebSocket()
})

onUnmounted(() => {
  disconnectWebSocket()
  disconnectDepthWebSocket()
  disconnectTradeWebSocket()
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
  return Math.min(...displayCandles.value.map(c => c.low!)) * 0.98
})

const maxPrice = computed(() => {
  if (priceRangeMax.value !== 0) return priceRangeMax.value
  return Math.max(...displayCandles.value.map(c => c.high!)) * 1.02
})

const priceDelta = computed(() => maxPrice.value - minPrice.value)

const svgWidth = computed(() => {
  return displayCandles.value.length * (candleWidth.value + candleGap) + 200
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
  let oi: { top: number; bottom: number } | null = null
  let ls: { top: number; bottom: number } | null = null

  if (showVolume.value) {
    const top = cursor + PANEL_GAP
    const bottom = top + VOLUME_PANEL_HEIGHT
    volume = { top, bottom }
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

  return { volume, oi, ls, totalHeight: cursor }
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
  return index * (candleWidth.value + candleGap) + candleWidth.value / 2 + 10
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
.large-trade-markers { pointer-events: none; }
.large-trade-dot { opacity: 0.85; stroke: #0d0d0d; stroke-width: 1; }
.large-trade-dot.buy  { fill: #26a69a; }
.large-trade-dot.sell { fill: #ef5350; }
.large-trade-label { font-size: 10px; font-weight: bold; text-anchor: middle; }
.large-trade-label.buy  { fill: #26a69a; }
.large-trade-label.sell { fill: #ef5350; }

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

/* ── FRVP confluence analysis modal ────────────────────────────────────── */
.frvp-analysis {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 2px 12px;
  color: #ccc;
  font-size: 13px;
}

.frvp-analysis-empty {
  padding: 24px;
  color: rgba(255,255,255,0.5);
  font-size: 13px;
  text-align: center;
}

.frvp-analysis-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: rgba(255,255,255,0.55);
}

.frvp-bias-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px;
  border-radius: 8px;
  border: 1px solid #444;
  background: rgba(255,255,255,0.04);
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
  color: rgba(255,255,255,0.6);
}

.frvp-bias-caveat {
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  font-style: italic;
}

.frvp-bias-long { border-color: rgba(38,166,154,0.5); }
.frvp-bias-long .frvp-bias-label { color: #26a69a; }
.frvp-bias-short { border-color: rgba(239,83,80,0.5); }
.frvp-bias-short .frvp-bias-label { color: #ef5350; }
.frvp-bias-neutral { border-color: rgba(255,255,255,0.25); }
.frvp-bias-neutral .frvp-bias-label { color: rgba(255,255,255,0.6); }

.frvp-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #eee;
}

.frvp-reason-list, .frvp-warning-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.frvp-warning-list { color: #d9a441; }

.frvp-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.frvp-badge {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #444;
  background: rgba(255,255,255,0.05);
  font-size: 12px;
  white-space: nowrap;
}

.frvp-pattern-explanation, .frvp-hist-unavailable {
  margin: 0;
  color: rgba(255,255,255,0.7);
}

.frvp-zone-detail {
  border: 1px solid #333;
  border-radius: 4px;
  margin-bottom: 6px;
  padding: 6px 10px;
}

.frvp-zone-detail summary {
  cursor: pointer;
  font-size: 12px;
  color: #ccc;
}

.frvp-zone-body {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(255,255,255,0.75);
}

.frvp-hit { color: #26a69a; }
.frvp-miss { color: #ef5350; }

/* ── Range Download scalp analysis dialog ────────────────────────────── */
.range-analysis {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 2px 12px;
  color: #ccc;
  font-size: 13px;
}

.range-analysis-empty {
  padding: 24px;
  color: rgba(255,255,255,0.5);
  font-size: 13px;
  text-align: center;
}

.range-analysis-error { color: #ef5350; }

.range-analysis-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: rgba(255,255,255,0.55);
}

.range-bias-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px;
  border-radius: 8px;
  border: 1px solid #444;
  background: rgba(255,255,255,0.04);
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
  color: rgba(255,255,255,0.45);
  font-style: italic;
}

.range-bias-long { border-color: rgba(38,166,154,0.5); }
.range-bias-long .range-bias-label { color: #26a69a; }
.range-bias-short { border-color: rgba(239,83,80,0.5); }
.range-bias-short .range-bias-label { color: #ef5350; }
.range-bias-neutral { border-color: rgba(255,255,255,0.25); }
.range-bias-neutral .range-bias-label { color: rgba(255,255,255,0.6); }

.range-trade-card {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px 16px;
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid #333;
  background: rgba(255,255,255,0.03);
}

.range-trade-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.range-trade-label {
  color: rgba(255,255,255,0.5);
}

.range-entry-quality { font-weight: 600; }
.range-eq-very_good, .range-eq-good { color: #26a69a; }
.range-eq-fair { color: #d9a441; }
.range-eq-poor, .range-eq-extended { color: #ef5350; }

.range-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #eee;
}

.range-thesis {
  margin: 0;
  color: rgba(255,255,255,0.8);
}

.range-reason-list, .range-warning-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.range-warning-list { color: #d9a441; }

.range-position-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #444;
  background: rgba(255,255,255,0.03);
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
  color: #eee;
}

.range-position-alignment {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #444;
}
.range-align-aligned { color: #26a69a; border-color: rgba(38,166,154,0.5); }
.range-align-opposed { color: #ef5350; border-color: rgba(239,83,80,0.5); }
.range-align-neutral { color: rgba(255,255,255,0.6); }

.range-position-confidence {
  font-size: 32px;
  font-weight: 700;
  color: #eee;
}

.range-position-confidence-label {
  font-size: 12px;
  font-weight: 400;
  color: rgba(255,255,255,0.5);
  margin-left: 8px;
}

.range-position-thesis {
  margin: 0;
  color: rgba(255,255,255,0.75);
  font-size: 13px;
}

.frvp-narrative p {
  margin: 0;
  padding: 10px 12px;
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.8);
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