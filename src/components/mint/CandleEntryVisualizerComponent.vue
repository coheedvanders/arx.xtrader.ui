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
      <span class="preview-stat tp"><label>TP</label><span>{{ previewPosition.tpPrice.toFixed(4) }}</span></span>
      <span class="preview-stat sl"><label>SL</label><span>{{ previewPosition.slPrice.toFixed(4) }}</span></span>
      <button class="preview-panel-close" @click="clearPreview">×</button>
    </div>
    <div v-if="previewError" class="preview-error">{{ previewError }}</div>

    <div class="chart-container" ref="chartContainer" @wheel="handleZoom" @mousemove="handleMouseMove" @mouseleave="handleMouseLeave" @mousedown="handleChartMouseDown">
      <svg :width="svgWidth" :height="svgHeight" class="candles-svg">
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
            :y2="svgHeight"
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

        <!-- Volume Bars (drawn behind candles/EMA, overlaid at the bottom of the chart) -->
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
          v-if="showVolume && maxVolumeInView > 0"
          :x="6"
          :y="svgHeight - volumePanelUsableHeight - 6"
          class="volume-panel-label"
        >
          Vol max {{ formatNotional(maxVolumeInView) }}
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
              'vp-target': vpModeActive
            }"
            @click="handleCandleClick(i)"
            @mousedown="handleCandleMouseDownForVp(i, $event)"
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
            v-for="(profile, pIdx) in renderedVolumeProfiles"
            :key="`vp-${pIdx}`"
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

            <!-- histogram rows: buy (left segment) + sell (right segment), stacked per row -->
            <g v-for="(row, rIdx) in profile.rows" :key="`vp-${pIdx}-row-${rIdx}`">
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
              :x="(candleX(profile.endIndex) + candleWidth / 2) - 4"
              :y="profile.rangeTop - 6"
              class="vp-close-btn"
              text-anchor="end"
              @click="removeVolumeProfile(pIdx)"
            >
              ✕ remove
            </text>
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

        <!-- Freeform rectangle draw tool overlay -->
        <g class="draw-rectangles">
          <g
            v-for="rect in drawnRectangles"
            :key="`rect-${rect.id}`"
            class="draw-rect-group"
          >
            <rect
              :x="rect.x"
              :y="rect.y"
              :width="rect.width"
              :height="rect.height"
              class="draw-rect"
            />
            <text
              :x="rect.x + rect.width - 4"
              :y="rect.y - 6"
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

        <!-- Price Axis Labels (Interactive) -->
        <text
          v-for="(price, i) in gridPrices"
          :key="`price-${i}`"
          :x="svgWidth"
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
</template>

<script setup lang="ts">
import type { CandleEntry, FuturesSymbol } from '@/core/interfaces';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
// NOTE: adjust this import path to wherever OrderMakerUtility actually lives in your project
import { OrderMakerUtility } from '@/utility/OrderMakerUtility';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import KeyLevelVisualizerComponent from './KeyLevelVisualizerComponent.vue';
import MACrossingVisualizerComponent from './MACrossingVisualizerComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore.ts';
import { isElementAccessExpression } from 'typescript';

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
const connectVolumeSpikesvSpikes = ref(false)
const showVolume = ref(true)
const showEma = ref(false)
const showMa = ref(true)
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

// ─── Freeform rectangle draw tool ──────────────────────────────────────────
//
// Click "Rectangle" to arm the tool, then click-drag anywhere on the chart
// to draw a highlight box. Unlike the Volume Profile tool, this is NOT
// snapped to candle index/price — it's stored in raw SVG pixel coordinates,
// so it behaves as a free annotation layer over the chart.
interface DrawnRectangle {
  id: number
  x: number
  y: number
  width: number
  height: number
}

let rectIdCounter = 0
const rectModeActive = ref(false)
const rectDrawing = ref(false)
const rectPreview = ref<DrawnRectangle | null>(null)
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
  rectPreview.value = { id: -1, x: start.x, y: start.y, width: 0, height: 0 }

  const handleMove = (moveEvent: MouseEvent) => {
    if (!rectDrawing.value) return
    const current = getSvgPoint(moveEvent)
    if (!current) return
    rectPreview.value = {
      id: -1,
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    }
  }

  const handleUp = () => {
    if (rectPreview.value && rectPreview.value.width > 2 && rectPreview.value.height > 2) {
      drawnRectangles.value.push({ ...rectPreview.value, id: ++rectIdCounter })
    }
    rectDrawing.value = false
    rectPreview.value = null
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
  startIndex: number
  endIndex: number
}

const VP_NUM_BUCKETS = 24
const VP_MAX_BAR_WIDTH = 140

const vpModeActive = ref(false)
const vpDragging = ref(false)
const vpStartIndex = ref<number | null>(null)
const vpEndIndex = ref<number | null>(null)
const volumeProfiles = ref<VolumeProfileRange[]>([])

function toggleVpMode() {
  vpModeActive.value = !vpModeActive.value
}

/** Wraps openCandleModal so the modal doesn't pop open mid-drag while the VP tool is armed. */
function handleCandleClick(index: number) {
  if (vpModeActive.value) return
  openCandleModal(index)
}

function removeVolumeProfile(index: number) {
  volumeProfiles.value.splice(index, 1)
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
        volumeProfiles.value.push({ startIndex: s, endIndex: e })
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
    rows,
    pocY: priceToY(pocPrice),
    pocPrice,
    totalVolume,
  }
}

/** All finalized (click-drag-completed) volume profiles, recomputed reactively as price scale/zoom changes. */
const renderedVolumeProfiles = computed(() => {
  return volumeProfiles.value
    .map(p => computeVolumeProfile(p.startIndex, p.endIndex))
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
 
      // Patch OHLC into a shallow copy of the last prop candle so all
      // computed indicators (zones, SR, etc.) remain intact.
      liveCandle.value = {
        ...lastPropCandle,
        openTime: k.t,
        open:  o,
        high:  h,
        low:   l,
        close: c,
        volume: isNaN(v) ? lastPropCandle.volume : v,
      }
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
  const base = (!liveCandle.value || props.candles.length === 0)
    ? props.candles
    : [...props.candles.slice(0, props.candles.length), liveCandle.value]

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

// ─── Volume panel (bottom-of-chart overlay, does not affect price scale) ──────
/** Reserved pixel height, at the bottom of the SVG, for volume bars. */
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

/** One bar per candle, anchored to the bottom of the chart, scaled by volume. */
const volumeBars = computed(() => {
  if (maxVolumeInView.value <= 0) return []
  return displayCandles.value.map((candle, i) => {
    const vol = candle.volume ?? 0
    const barHeight = (vol / maxVolumeInView.value) * volumePanelUsableHeight
    return {
      x: candleX(i) - candleWidth.value / 2,
      y: svgHeight - barHeight,
      width: candleWidth.value,
      height: barHeight,
      isBull: candle.close! >= candle.open!,
    }
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
const priceToY = (price: number): number => {
  return ((maxPrice.value - price) / priceDelta.value) * svgHeight
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

.vp-close-btn {
  fill: #ef5350;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  pointer-events: all;
}

.vp-close-btn:hover {
  fill: #ff8a80;
}

/* ── Freeform rectangle draw tool ─────────────────────────────────────── */
.draw-rect {
  fill: rgba(255, 213, 79, 0.12);
  stroke: #ffd54f;
  stroke-width: 1.5;
  pointer-events: all;
}
.draw-rect-preview {
  stroke-dasharray: 4, 3;
  pointer-events: none;
}
.draw-rect-close {
  fill: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  cursor: pointer;
  pointer-events: all;
}
.draw-rect-close:hover {
  fill: #ff8a80;
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

/* ── Volume bars (bottom-of-chart overlay) ────────────────────────────── */
.volume-bars { pointer-events: none; }
.volume-bar { opacity: 0.35; }
.volume-bar.bull { fill: #26a69a; }
.volume-bar.bear { fill: #ef5350; }
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