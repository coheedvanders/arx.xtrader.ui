<template>
  <div class="cev2-root" :class="{ 'overlay-instance': overlayMode }">
    <!-- ── Top bar ──────────────────────────────────────────────────────── -->
    <div v-if="!overlayMode" class="topbar">
      <div class="topbar-group">
        <span class="symbol-badge">{{ symbol }}</span>

        <div class="tf-tabs" role="tablist" aria-label="Primary timeframe">
          <button
            v-for="tf in TF_LIST"
            :key="tf"
            class="tf-tab"
            :class="{ active: primaryTf === tf }"
            @click="setPrimaryTf(tf)"
          >{{ tf.toUpperCase() }}</button>
        </div>
      </div>

      <div class="topbar-group">
        <button
          v-for="tf in OVERLAY_TF_LIST"
          :key="tf"
          class="chip"
          :class="{ active: overlayFlags[tf], disabled: primaryTf === tf }"
          :disabled="primaryTf === tf"
          :title="`Overlay ${tf.toUpperCase()} candles from symbol info`"
          @click="overlayFlags[tf] = !overlayFlags[tf]"
        >{{ tf.toUpperCase() }}</button>

        <button
          class="chip"
          :class="{ active: showCrossTfEma }"
          title="Project 15M/1H/4H/1D EMA200 onto this chart (hotkey: E)"
          @click="showCrossTfEma = !showCrossTfEma"
        >XTF EMA</button>

        <div class="prop-select" ref="propSelectRef">
          <button
            class="chip prop-select-btn"
            title="Choose the numeric property plotted in the bar below the chart"
            @click="propMenuOpen = !propMenuOpen"
          >{{ selectedProp.toUpperCase() }} ▾</button>
          <div v-if="propMenuOpen" class="prop-select-menu">
            <input
              v-model="propSearch"
              type="text"
              class="prop-select-search"
              placeholder="Search property…"
              autofocus
            />
            <div class="prop-select-list">
              <button
                v-for="p in filteredProps"
                :key="p"
                class="prop-select-item"
                :class="{ active: p === selectedProp }"
                @click="selectProp(p)"
              >{{ p }}</button>
              <div v-if="filteredProps.length === 0" class="prop-select-empty">No matches</div>
            </div>
          </div>
        </div>

        <button
          class="preview-top-btn buy"
          :class="{ active: previewLoading && pendingSide === 'LONG' }"
          :disabled="previewLoading"
          title="Preview a LONG position at the latest visible candle"
          @click="previewBuy"
        >{{ previewLoading && pendingSide === "LONG" ? "…" : "Preview Buy" }}</button>
        <button
          class="preview-top-btn sell"
          :class="{ active: previewLoading && pendingSide === 'SHORT' }"
          :disabled="previewLoading"
          title="Preview a SHORT position at the latest visible candle"
          @click="previewSell"
        >{{ previewLoading && pendingSide === "SHORT" ? "…" : "Preview Sell" }}</button>
        <button
          class="preview-top-btn place"
          :disabled="!previewPosition || placingOrder"
          title="Place the currently previewed order"
          @click="placeOrder"
        >{{ placingOrder ? "Placing…" : "Place Order" }}</button>
      </div>

      <div class="topbar-group topbar-group-right">
        <label class="bars-control" title="Candles visible in view">
          <span class="bars-control-label">Bars</span>
          <select v-model.number="visibleBars" class="bars-select">
            <option v-for="n in BARS_PRESETS" :key="n" :value="n">{{ n }}</option>
          </select>
          <input
            v-model.number="visibleBars"
            type="number"
            min="20"
            :max="maxVisibleBars"
            class="bars-input"
            title="Custom bar count"
          />
        </label>

        <button class="icon-btn" title="Reset view (E)" @click="scrollToLatest">⇥</button>
        <button class="icon-btn" title="Refresh from IndexedDB" @click="loadSymbolInfo">⟳</button>
        <button class="icon-btn" title="Keyboard shortcuts (?)" @click="showHotkeysModal = true">⌨</button>
      </div>
    </div>

    <div class="body-row">
      <!-- ── Tool rail ────────────────────────────────────────────────── -->
      <div v-if="!overlayMode" class="tool-rail">
        <button
          v-for="tool in TOOL_DEFS"
          :key="tool.id"
          class="rail-btn"
          :class="{ active: activeTool === tool.id }"
          :title="`${tool.label} (${tool.key.toUpperCase()})`"
          @click="setActiveTool(tool.id)"
        >{{ tool.icon }}</button>

        <div class="rail-sep" />

        <button class="rail-btn" title="Clear all drawings (C)" @click="clearAllDrawings">✕</button>
      </div>

      <!-- ── Chart ────────────────────────────────────────────────────── -->
      <div
        ref="chartContainer"
        class="chart-container"
        :class="{ [`tool-${activeTool}`]: activeTool !== 'none' }"
        @wheel.prevent="onWheel"
        @mousedown="onChartMouseDown"
        @mousemove="onChartMouseMove"
        @mouseleave="onChartMouseLeave"
        @mouseup="onChartMouseUp"
        @dblclick="onChartDoubleClick"
      >
        <div v-if="loading" class="chart-status">Loading {{ symbol }} from cache…</div>
        <div v-else-if="loadError" class="chart-status chart-status-error">{{ loadError }}</div>
        <div v-else-if="primaryCandles.length === 0" class="chart-status">No {{ primaryTf.toUpperCase() }} candles cached for {{ symbol }}.</div>

        <template v-else>
          <svg :width="chartWidth" :height="chartHeight" class="chart-svg">
            <!-- grid -->
            <g class="grid">
              <line
                v-for="(g, i) in priceGridLines"
                :key="'g' + i"
                class="grid-line"
                :x1="0" :x2="plotWidth" :y1="g.y" :y2="g.y"
              />
            </g>

            <!-- candles (drawn beneath drawing tools so drawings/handles stay clickable) -->
            <g class="candles">
              <g
                v-for="c in displayCandles"
                :key="c.gi"
                class="candle"
                :class="{ bull: c.candle.candleStructure?.isBullish, bear: c.candle.candleStructure?.isBearish }"
              >
                <line
                  class="wick"
                  :x1="candleX(c.gi)" :x2="candleX(c.gi)"
                  :y1="priceToY(c.candle.high)" :y2="priceToY(c.candle.low)"
                />
                <rect
                  class="body"
                  :x="candleX(c.gi) - candleWidth * 0.62 / 2"
                  :y="priceToY(Math.max(c.candle.open, c.candle.close))"
                  :width="candleWidth * 0.62"
                  :height="Math.max(1, Math.abs(priceToY(c.candle.open) - priceToY(c.candle.close)))"
                />
                <!-- <circle
                  v-if="c.candle.anchors?.avwap?.isAnchor"
                  class="anchor-dot anchor-avwap"
                  :cx="candleX(c.gi)" :cy="priceToY(c.candle.high) - 8" r="2.5"
                />
                <circle
                  v-if="c.candle.anchors?.frvp?.isAnchor"
                  class="anchor-dot anchor-frvp"
                  :cx="candleX(c.gi) - 5" :cy="priceToY(c.candle.high) - 8" r="2.5"
                />
                <circle
                  v-if="c.candle.anchors?.liquidityHeatmap?.isAnchor"
                  class="anchor-dot anchor-liq"
                  :cx="candleX(c.gi) + 5" :cy="priceToY(c.candle.high) - 8" r="2.5"
                /> -->

                <g
                    v-if="c.candle.confluenceScore?.direction !== 'NEUTRAL' && c.candle.confluenceScore?.confidence! >= 34"
                    class="confluence-marker"
                    :class="{
                        'confluence-long': c.candle.confluenceScore?.direction === 'LONG',
                        'confluence-short': c.candle.confluenceScore?.direction === 'SHORT'
                    }"
                >
                    <path
                        v-if="c.candle.confluenceScore?.direction === 'LONG'"
                        class="confluence-chevron"
                        :d="`
                            M ${candleX(c.gi) - 6} ${priceToY(c.candle.low) + 12}
                            L ${candleX(c.gi)} ${priceToY(c.candle.low) + 6}
                            L ${candleX(c.gi) + 6} ${priceToY(c.candle.low) + 12}
                        `"
                    />

                    <path
                        v-else
                        class="confluence-chevron"
                        :d="`
                            M ${candleX(c.gi) - 6} ${priceToY(c.candle.high) - 12}
                            L ${candleX(c.gi)} ${priceToY(c.candle.high) - 6}
                            L ${candleX(c.gi) + 6} ${priceToY(c.candle.high) - 12}
                        `"
                    />

                    <text
                        class="confluence-confidence"
                        :x="candleX(c.gi)"
                        :y="
                            c.candle.confluenceScore?.direction === 'LONG'
                                ? priceToY(c.candle.low) + 28
                                : priceToY(c.candle.high) - 28
                        "
                        text-anchor="middle"
                    >
                        {{ Math.round(c.candle.confluenceScore?.confidence ?? 0) }}%
                    </text>
                </g>
                
              </g>
            </g>

            <!-- liquidation heatmap -->
            <g v-for="range in liquidityRanges" :key="range.id" class="liquidity-heatmap" @mousedown.stop="selectDrawing('liquidity', range.id)">
              <rect
                v-for="cell in range.cells"
                :key="cell.candleIndex + '-' + cell.bucketIndex"
                :x="candleX(cell.candleIndex + range.startGi) - candleWidth / 2"
                :y="priceToY(cell.priceHigh)"
                :width="candleWidth"
                :height="Math.max(1, priceToY(cell.priceLow) - priceToY(cell.priceHigh))"
                :fill="cell.color"
              />
              <rect
                class="heatmap-range-outline"
                :class="{ selected: isDrawingSelected('liquidity', range.id) }"
                :x="candleX(range.startGi) - candleWidth / 2"
                :y="priceToY(range.high)"
                :width="Math.max(2, candleX(range.endGi) - candleX(range.startGi) + candleWidth)"
                :height="Math.max(2, priceToY(range.low) - priceToY(range.high))"
              />
              <line class="drawing-edge-handle" :x1="candleX(range.startGi) - candleWidth / 2" :x2="candleX(range.startGi) - candleWidth / 2" :y1="priceToY(range.high)" :y2="priceToY(range.low)" @mousedown="startLiquidityResize(range.id, 'left', $event)" />
              <line class="drawing-edge-handle" :x1="candleX(range.endGi) + candleWidth / 2" :x2="candleX(range.endGi) + candleWidth / 2" :y1="priceToY(range.high)" :y2="priceToY(range.low)" @mousedown="startLiquidityResize(range.id, 'right', $event)" />
              <text class="drawing-remove" :x="candleX(range.startGi) - candleWidth / 2 + 4" :y="priceToY(range.high) - 6" @click.stop="removeDrawing('liquidity', range.id)">✕</text>
            </g>

            <!-- multi-tf ghost candles -->
            <template v-for="tf in OVERLAY_TF_LIST" :key="'ov-' + tf">
              <g v-if="overlayFlags[tf]" class="overlay-candles">
                <g v-for="box in overlayBoxes[tf]" :key="box.id">
                  <rect
                    class="overlay-body"
                    :class="{ bull: box.bullish, bear: !box.bullish }"
                    :x="box.x1"
                    :y="priceToY(Math.max(box.open, box.close))"
                    :width="Math.max(2, box.x2 - box.x1)"
                    :height="Math.max(1, Math.abs(priceToY(box.open) - priceToY(box.close)))"
                  />
                  <line
                    class="overlay-wick"
                    :class="{ bull: box.bullish, bear: !box.bullish }"
                    :x1="(box.x1 + box.x2) / 2" :x2="(box.x1 + box.x2) / 2"
                    :y1="priceToY(box.high)" :y2="priceToY(box.low)"
                  />
                </g>
              </g>
            </template>

            <!-- FRVP zones: buy/sell split, profile grows LEFT from the range start -->
            <g v-for="zone in frvpZones" :key="zone.id" class="frvp-zone" @mousedown.stop="selectDrawing('frvp', zone.id)">
              <rect
                :x="candleX(Math.min(zone.startGi, zone.endGi)) - candleWidth / 2"
                :y="priceToY(zone.rangeHigh)"
                :width="Math.max(1, candleX(Math.max(zone.startGi, zone.endGi)) - candleX(Math.min(zone.startGi, zone.endGi)) + candleWidth)"
                :height="Math.max(1, priceToY(zone.rangeLow) - priceToY(zone.rangeHigh))"
                class="frvp-range-box"
                :class="{ selected: isDrawingSelected('frvp', zone.id) }"
              />
              <g v-for="(row, ri) in zone.rows" :key="ri">
                <rect
                  class="frvp-row frvp-buy"
                  :x="candleX(Math.min(zone.startGi, zone.endGi)) - candleWidth / 2"
                  :y="priceToY(row.priceHigh)"
                  :width="row.buyFrac * frvpProfileWidth(zone)"
                  :height="Math.max(1, priceToY(row.priceLow) - priceToY(row.priceHigh))"
                />
                <rect
                  class="frvp-row frvp-sell"
                  :x="candleX(Math.min(zone.startGi, zone.endGi)) - candleWidth / 2 + row.buyFrac * frvpProfileWidth(zone)"
                  :y="priceToY(row.priceHigh)"
                  :width="row.sellFrac * frvpProfileWidth(zone)"
                  :height="Math.max(1, priceToY(row.priceLow) - priceToY(row.priceHigh))"
                />
              </g>
              <line
                class="frvp-poc"
                :x1="candleX(Math.min(zone.startGi, zone.endGi)) - candleWidth / 2"
                :x2="candleX(Math.min(zone.startGi, zone.endGi)) - candleWidth / 2 + frvpProfileWidth(zone)"
                :y1="priceToY(zone.poc)" :y2="priceToY(zone.poc)"
              />
              <line
                class="drawing-edge-handle frvp-left-handle"
                :x1="candleX(Math.min(zone.startGi, zone.endGi)) - candleWidth / 2"
                :x2="candleX(Math.min(zone.startGi, zone.endGi)) - candleWidth / 2"
                :y1="priceToY(zone.rangeHigh)" :y2="priceToY(zone.rangeLow)"
                @mousedown="startFrvpResize(zone.id, 'left', $event)"
              />
              <line
                class="drawing-edge-handle frvp-right-handle"
                :x1="candleX(Math.max(zone.startGi, zone.endGi)) + candleWidth / 2"
                :x2="candleX(Math.max(zone.startGi, zone.endGi)) + candleWidth / 2"
                :y1="priceToY(zone.rangeHigh)" :y2="priceToY(zone.rangeLow)"
                @mousedown="startFrvpResize(zone.id, 'right', $event)"
              />
              <text
                class="drawing-remove"
                :x="candleX(Math.max(zone.startGi, zone.endGi)) + candleWidth / 2 - 4"
                :y="priceToY(zone.rangeHigh) - 6"
                text-anchor="end"
                @click.stop="removeDrawing('frvp', zone.id)"
              >✕</text>
            </g>

            <!-- AVWAP lines -->
            <g v-for="line in avwapLines" :key="line.id" class="avwap-group" @mousedown.stop="selectDrawing('avwap', line.id)">
              <polyline
                class="avwap-line"
                :class="{ selected: isDrawingSelected('avwap', line.id) }"
                :points="line.points.map(p => `${candleX(p.gi)},${priceToY(p.price)}`).join(' ')"
              />
              <line
                class="drawing-edge-handle avwap-anchor-handle"
                :x1="candleX(line.anchorGi)" :x2="candleX(line.anchorGi)"
                y1="0" :y2="mainPlotHeight"
                @mousedown="startAvwapResize(line.id, $event)"
              />
              <circle
                class="avwap-anchor-handle-visible"
                :cx="candleX(line.anchorGi)"
                :cy="priceToY(line.points[0]?.price ?? 0)"
                r="5"
                @mousedown="startAvwapResize(line.id, $event)"
              />
              <text
                class="drawing-remove"
                :x="candleX(line.anchorGi) + 6"
                :y="priceToY(line.points[0]?.price ?? 0) - 8"
                @click.stop="removeDrawing('avwap', line.id)"
              >✕</text>
            </g>

            <!-- Cross-TF EMA lines -->
            <template v-for="tf in XTF_EMA_TF_LIST" :key="'ema-' + tf">
              <g v-if="showCrossTfEma && crossTfEmaLines[tf].length > 1">
                <polyline
                  class="xtf-ema-line"
                  :class="'xtf-ema-' + tf"
                  :points="crossTfEmaLines[tf].map(p => `${candleX(p.gi)},${priceToY(p.price)}`).join(' ')"
                />
                <text
                  class="xtf-ema-label"
                  :class="'xtf-ema-' + tf"
                  :x="candleX(crossTfEmaLines[tf][crossTfEmaLines[tf].length - 1].gi) + 4"
                  :y="priceToY(crossTfEmaLines[tf][crossTfEmaLines[tf].length - 1].price) + 3"
                >{{ tf.toUpperCase() }} EMA</text>
              </g>
            </template>

            <!-- rectangles -->
            <g v-for="r in rectangles" :key="r.id" class="drawing-group" @mousedown.stop="selectDrawing('rectangle', r.id)">
              <rect
                class="drawn-rect"
                :class="{ selected: isDrawingSelected('rectangle', r.id) }"
                :x="Math.min(candleX(r.x1), candleX(r.x2))"
                :y="Math.min(priceToY(r.y1), priceToY(r.y2))"
                :width="Math.max(2, Math.abs(candleX(r.x2) - candleX(r.x1)))"
                :height="Math.max(2, Math.abs(priceToY(r.y2) - priceToY(r.y1)))"
              />
              <line class="drawing-edge-handle" :x1="candleX(Math.min(r.x1, r.x2))" :x2="candleX(Math.min(r.x1, r.x2))" :y1="priceToY(Math.max(r.y1, r.y2))" :y2="priceToY(Math.min(r.y1, r.y2))" @mousedown="startDrawingResize('rectangle', r.id, 'left', $event)" />
              <line class="drawing-edge-handle" :x1="candleX(Math.max(r.x1, r.x2))" :x2="candleX(Math.max(r.x1, r.x2))" :y1="priceToY(Math.max(r.y1, r.y2))" :y2="priceToY(Math.min(r.y1, r.y2))" @mousedown="startDrawingResize('rectangle', r.id, 'right', $event)" />
              <line class="drawing-edge-handle" :x1="candleX(Math.min(r.x1, r.x2))" :x2="candleX(Math.max(r.x1, r.x2))" :y1="priceToY(Math.max(r.y1, r.y2))" :y2="priceToY(Math.max(r.y1, r.y2))" @mousedown="startDrawingResize('rectangle', r.id, 'top', $event)" />
              <line class="drawing-edge-handle" :x1="candleX(Math.min(r.x1, r.x2))" :x2="candleX(Math.max(r.x1, r.x2))" :y1="priceToY(Math.min(r.y1, r.y2))" :y2="priceToY(Math.min(r.y1, r.y2))" @mousedown="startDrawingResize('rectangle', r.id, 'bottom', $event)" />
              <rect class="drawing-move-hit" :x="Math.min(candleX(r.x1), candleX(r.x2)) + 5" :y="Math.min(priceToY(r.y1), priceToY(r.y2)) + 5" :width="Math.max(2, Math.abs(candleX(r.x2) - candleX(r.x1)) - 10)" :height="Math.max(2, Math.abs(priceToY(r.y2) - priceToY(r.y1)) - 10)" @mousedown="startDrawingMove('rectangle', r.id, $event)" />
              <text class="drawing-remove" :x="Math.max(candleX(r.x1), candleX(r.x2)) - 4" :y="Math.min(priceToY(r.y1), priceToY(r.y2)) - 6" text-anchor="end" @click.stop="removeDrawing('rectangle', r.id)">✕</text>
            </g>

            <!-- lines -->
            <g v-for="l in trendLines" :key="l.id" class="drawing-group" @mousedown.stop="selectDrawing('line', l.id)">
              <line class="drawn-line" :class="{ selected: isDrawingSelected('line', l.id) }" :x1="candleX(l.x1)" :y1="priceToY(l.y1)" :x2="candleX(l.x2)" :y2="priceToY(l.y2)" />
              <line class="drawing-hit-line" :x1="candleX(l.x1)" :y1="priceToY(l.y1)" :x2="candleX(l.x2)" :y2="priceToY(l.y2)" @mousedown="startDrawingMove('line', l.id, $event)" />
              <circle class="drawing-handle" :cx="candleX(l.x1)" :cy="priceToY(l.y1)" r="5" @mousedown="startLineEndpointResize(l.id, 'start', $event)" />
              <circle class="drawing-handle" :cx="candleX(l.x2)" :cy="priceToY(l.y2)" r="5" @mousedown="startLineEndpointResize(l.id, 'end', $event)" />
              <text class="drawing-remove" :x="candleX(l.x2) + 6" :y="priceToY(l.y2) - 6" @click.stop="removeDrawing('line', l.id)">✕</text>
            </g>

            <!-- horizontal price lines -->
            <g v-for="hl in horizontalLines" :key="hl.id" class="drawing-group" @mousedown.stop="selectDrawing('horizontal-line', hl.id)">
              <line
                class="drawn-horizontal-line"
                :class="{ selected: isDrawingSelected('horizontal-line', hl.id) }"
                x1="0" :x2="plotWidth"
                :y1="priceToY(hl.price)" :y2="priceToY(hl.price)"
              />
              <line
                class="drawing-hit-horizontal"
                x1="0" :x2="plotWidth"
                :y1="priceToY(hl.price)" :y2="priceToY(hl.price)"
                @mousedown="startHorizontalLineMove(hl.id, $event)"
              />
              <text
                class="drawing-remove"
                :x="plotWidth - 4"
                :y="priceToY(hl.price) - 6"
                text-anchor="end"
                @click.stop="removeDrawing('horizontal-line', hl.id)"
              >✕</text>
            </g>

            <!-- price range measure boxes -->
            <g v-for="pr in priceRangeBoxes" :key="pr.id" class="price-range-box-group" @mousedown.stop="selectDrawing('price-range', pr.id)">
              <rect
                class="price-range-box"
                :class="{ up: pr.y2 >= pr.y1, selected: isDrawingSelected('price-range', pr.id) }"
                :x="Math.min(candleX(pr.x1), candleX(pr.x2))"
                :y="Math.min(priceToY(pr.y1), priceToY(pr.y2))"
                :width="Math.max(2, Math.abs(candleX(pr.x2) - candleX(pr.x1)))"
                :height="Math.max(2, Math.abs(priceToY(pr.y2) - priceToY(pr.y1)))"
              />
              <line class="drawing-edge-handle" :x1="candleX(Math.min(pr.x1, pr.x2))" :x2="candleX(Math.min(pr.x1, pr.x2))" :y1="priceToY(Math.max(pr.y1, pr.y2))" :y2="priceToY(Math.min(pr.y1, pr.y2))" @mousedown="startDrawingResize('price-range', pr.id, 'left', $event)" />
              <line class="drawing-edge-handle" :x1="candleX(Math.max(pr.x1, pr.x2))" :x2="candleX(Math.max(pr.x1, pr.x2))" :y1="priceToY(Math.max(pr.y1, pr.y2))" :y2="priceToY(Math.min(pr.y1, pr.y2))" @mousedown="startDrawingResize('price-range', pr.id, 'right', $event)" />
              <line class="drawing-edge-handle" :x1="candleX(Math.min(pr.x1, pr.x2))" :x2="candleX(Math.max(pr.x1, pr.x2))" :y1="priceToY(Math.max(pr.y1, pr.y2))" :y2="priceToY(Math.max(pr.y1, pr.y2))" @mousedown="startDrawingResize('price-range', pr.id, 'top', $event)" />
              <line class="drawing-edge-handle" :x1="candleX(Math.min(pr.x1, pr.x2))" :x2="candleX(Math.max(pr.x1, pr.x2))" :y1="priceToY(Math.min(pr.y1, pr.y2))" :y2="priceToY(Math.min(pr.y1, pr.y2))" @mousedown="startDrawingResize('price-range', pr.id, 'bottom', $event)" />
              <rect class="drawing-move-hit" :x="Math.min(candleX(pr.x1), candleX(pr.x2)) + 5" :y="Math.min(priceToY(pr.y1), priceToY(pr.y2)) + 5" :width="Math.max(2, Math.abs(candleX(pr.x2) - candleX(pr.x1)) - 10)" :height="Math.max(2, Math.abs(priceToY(pr.y2) - priceToY(pr.y1)) - 10)" @mousedown="startDrawingMove('price-range', pr.id, $event)" />
              <text class="price-range-label" :x="(candleX(pr.x1) + candleX(pr.x2)) / 2" :y="Math.min(priceToY(pr.y1), priceToY(pr.y2)) - 6">{{ formatPriceRangeLabel(pr) }}</text>
              <text class="drawing-remove" :x="Math.max(candleX(pr.x1), candleX(pr.x2)) - 4" :y="Math.min(priceToY(pr.y1), priceToY(pr.y2)) - 18" text-anchor="end" @click.stop="removeDrawing('price-range', pr.id)">✕</text>
            </g>

            <!-- live tool draft preview -->
            <g v-if="toolDraft" class="tool-draft">
              <rect
                v-if="activeTool === 'rectangle' || activeTool === 'price-range' || activeTool === 'frvp' || activeTool === 'liquidity'"
                class="draft-rect"
                :x="Math.min(candleX(toolDraft.startGi), candleX(toolDraft.curGi))"
                :y="Math.min(priceToY(toolDraft.startPrice), priceToY(toolDraft.curPrice))"
                :width="Math.max(1, Math.abs(candleX(toolDraft.curGi) - candleX(toolDraft.startGi)))"
                :height="Math.max(1, Math.abs(priceToY(toolDraft.curPrice) - priceToY(toolDraft.startPrice)))"
              />
              <line
                v-if="activeTool === 'line'"
                class="draft-line"
                :x1="candleX(toolDraft.startGi)" :y1="priceToY(toolDraft.startPrice)"
                :x2="candleX(toolDraft.curGi)" :y2="priceToY(toolDraft.curPrice)"
              />
            </g>

            <!-- preview buy/sell position -->
            <g v-if="previewPosition" class="preview-position">
              <rect class="preview-zone preview-tp"
                :x="candleX(previewPosition.entryGi) - candleWidth / 2"
                :y="priceToY(Math.max(previewPosition.entryPrice, previewPosition.tp))"
                :width="plotWidth - candleX(previewPosition.entryGi) + candleWidth / 2"
                :height="Math.max(1, Math.abs(priceToY(previewPosition.entryPrice) - priceToY(previewPosition.tp)))" />
              <rect class="preview-zone preview-sl"
                :x="candleX(previewPosition.entryGi) - candleWidth / 2"
                :y="priceToY(Math.max(previewPosition.entryPrice, previewPosition.sl))"
                :width="plotWidth - candleX(previewPosition.entryGi) + candleWidth / 2"
                :height="Math.max(1, Math.abs(priceToY(previewPosition.entryPrice) - priceToY(previewPosition.sl)))" />
              <line class="preview-entry-line"
                :x1="candleX(previewPosition.entryGi) - candleWidth / 2" :x2="plotWidth"
                :y1="priceToY(previewPosition.entryPrice)" :y2="priceToY(previewPosition.entryPrice)" />
              <line class="preview-tp-line"
                :x1="candleX(previewPosition.entryGi) - candleWidth / 2" :x2="plotWidth"
                :y1="priceToY(previewPosition.tp)" :y2="priceToY(previewPosition.tp)" />
              <line class="preview-hit-line"
                :x1="candleX(previewPosition.entryGi) - candleWidth / 2" :x2="plotWidth"
                :y1="priceToY(previewPosition.tp)" :y2="priceToY(previewPosition.tp)"
                @mousedown="startPreviewPriceDrag('tp', $event)" />
              <line class="preview-sl-line"
                :x1="candleX(previewPosition.entryGi) - candleWidth / 2" :x2="plotWidth"
                :y1="priceToY(previewPosition.sl)" :y2="priceToY(previewPosition.sl)" />
              <line class="preview-hit-line"
                :x1="candleX(previewPosition.entryGi) - candleWidth / 2" :x2="plotWidth"
                :y1="priceToY(previewPosition.sl)" :y2="priceToY(previewPosition.sl)"
                @mousedown="startPreviewPriceDrag('sl', $event)" />
            </g>

            <!-- crosshair -->
            <g v-if="hover" class="crosshair">
              <line class="crosshair-line" :x1="hover.x" :x2="hover.x" y1="0" :y2="mainPlotHeight" />
              <line class="crosshair-line" x1="0" :x2="plotWidth" :y1="hover.y" :y2="hover.y" />
            </g>

            <!-- current price line: dashed, full chart width, bull/bear colored -->
            <g v-if="livePriceLineY != null" class="live-price-group">
              <line
                class="live-price-line"
                :class="livePriceBullish ? 'bull' : 'bear'"
                x1="0" :x2="chartWidth"
                :y1="livePriceLineY" :y2="livePriceLineY"
              />
              <text
                class="live-price-label"
                :class="livePriceBullish ? 'bull' : 'bear'"
                :x="plotWidth + 6" :y="livePriceLineY + 4"
              >{{ formatPrice(livePrice) }}</text>
            </g>

            <!-- price axis -->
            <g class="price-axis">
              <text
                v-for="(g, i) in priceGridLines"
                :key="'pl' + i"
                class="price-label"
                :x="plotWidth + 6" :y="g.y + 4"
              >{{ formatPrice(g.price) }}</text>
              <text v-if="hover" class="price-label hover-price-label" :x="plotWidth + 6" :y="hover.y + 4">{{ formatPrice(hover.price) }}</text>
            </g>

            <!-- time axis -->
            <g class="time-axis" :transform="`translate(0, ${mainPlotHeight + subplotsHeight})`">
              <text
                v-for="t in timeAxisTicks"
                :key="t.gi"
                class="time-label"
                :x="candleX(t.gi)" y="14"
              >{{ t.label }}</text>
            </g>

            <!-- Dynamic property subplot (defaults to volume; selectable near XTF EMA) -->
            <g class="subplot prop-subplot" :transform="`translate(0, ${mainPlotHeight + 4})`">
              <text class="subplot-title" x="4" y="10">{{ selectedProp.toUpperCase() }}</text>
              <rect
                v-for="b in propBars"
                :key="'pv' + b.gi"
                class="prop-bar"
                :x="candleX(b.gi) - candleWidth * 0.62 / 2"
                :y="PROP_HEIGHT - b.h"
                :width="candleWidth * 0.62"
                :height="Math.max(0.5, b.h)"
              />
            </g>
          </svg>

          <!-- HUD readout -->
          <div class="hud">
            <span class="hud-symbol">{{ symbol }}</span>
            <span class="hud-tf">{{ primaryTf.toUpperCase() }}</span>
            <span v-if="livePrice != null" class="hud-live-price">LIVE <b>{{ formatPrice(livePrice) }}</b></span>
            <template v-if="hoveredCandle">
              <span class="hud-item">O<b>{{ formatPrice(hoveredCandle.open) }}</b></span>
              <span class="hud-item">H<b>{{ formatPrice(hoveredCandle.high) }}</b></span>
              <span class="hud-item">L<b>{{ formatPrice(hoveredCandle.low) }}</b></span>
              <span class="hud-item">C<b>{{ formatPrice(hoveredCandle.close) }}</b></span>
              <span class="hud-item" :class="hoveredCandle.candleStructure?.isBullish ? 'up' : 'down'">
                {{ hoveredCandle.candleStructure?.isBullish ? '▲' : '▼' }}
                {{ (hoveredCandle.candleStructure?.bodyRatio * 100).toFixed(0) }}% body
              </span>
              <span class="hud-item">ATR<b>{{ formatPrice(hoveredCandle.atr) }}</b></span>
            </template>
          <div v-if="selectedDrawing" class="drawing-toolbar">
            <span>{{ selectedDrawing.type.toUpperCase() }}</span>
            <button @click.stop="removeDrawing(selectedDrawing.type, selectedDrawing.id)">✕ Remove</button>
            <button @click.stop="selectedDrawing = null">Done</button>
          </div>
          </div>
        </template>

        <!-- preview position control panel -->
        <div v-if="previewError" class="preview-error">{{ previewError }}</div>
        <div
          v-if="previewPosition"
          class="preview-panel"
          :style="previewPanelStyle"
        >
          <div class="preview-panel-title" @mousedown.stop="startPreviewPanelDrag">
            <span>{{ previewPosition.side === 'buy' ? 'LONG' : 'SHORT' }} preview</span>
            <button class="preview-panel-close" @click="previewPosition = null">✕</button>
          </div>
          <div class="preview-panel-row">
            <label>Entry</label>
            <span>{{ formatPrice(previewPosition.entryPrice) }}</span>
          </div>
          <div class="preview-panel-row">
            <label>Margin</label>
            <input type="number" min="0" step="1" v-model.number="previewMargin" />
          </div>
          <div class="preview-panel-row">
            <label>TP</label>
            <input type="number" v-model.number="previewPosition.tp" :step="priceStep" />
          </div>
          <div class="preview-panel-row">
            <label>SL</label>
            <input type="number" v-model.number="previewPosition.sl" :step="priceStep" />
          </div>
          <div class="preview-panel-row preview-panel-rr">
            <label>R:R</label>
            <span>{{ previewRR }}</span>
          </div>
          <button class="preview-order-btn" :disabled="placingOrder" @click="placeOrder">
            {{ placingOrder ? "Placing…" : "Place Order" }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Candle detail modal ──────────────────────────────────────────── -->
    <div v-if="selectedCandle" class="modal-overlay" @click.self="selectedCandle = null">
      <div class="modal-content candle-detail-modal">
        <div class="modal-header">
          <h2>{{ symbol }} · {{ primaryTf.toUpperCase() }} · {{ formatDateTime(selectedCandle.candle.openTime) }}</h2>
          <button class="close-btn" @click="selectedCandle = null">✕</button>
        </div>
        <div class="modal-body">
          <div class="detail-grid">
            <DynamicDetailSection
              v-for="([key, value], index) in objectEntries(selectedCandle.candle)"
              :key="key"
              :label="formatDetailLabel(key)"
              :value="value"
              :depth="0"
              :accent-index="index"
            />

            <div class="detail-section" v-if="selectedCandleOi || selectedCandleLs">
              <h3>Positioning</h3>
              <div v-if="selectedCandleOi" class="detail-subsection">
                <div class="detail-item"><label>Open interest</label><span>{{ formatNumber(selectedCandleOi.sumOpenInterest) }}</span></div>
                <div class="detail-item"><label>OI value</label><span>{{ formatNumber(selectedCandleOi.sumOpenInterestValue) }}</span></div>
              </div>
              <div v-if="selectedCandleLs" class="detail-subsection">
                <div class="detail-item"><label>Long/Short ratio</label><span>{{ selectedCandleLs.longShortRatio.toFixed(3) }}</span></div>
                <div class="detail-item"><label>Long / Short %</label><span>{{ pct(selectedCandleLs.longAccount) }} / {{ pct(selectedCandleLs.shortAccount) }}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Hotkeys modal ────────────────────────────────────────────────── -->
    <div v-if="showHotkeysModal" class="modal-overlay" @click.self="showHotkeysModal = false">
      <div class="modal-content hotkeys-modal">
        <div class="modal-header">
          <h2>Keyboard shortcuts</h2>
          <button class="close-btn" @click="showHotkeysModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="hotkey-row" v-for="hk in HOTKEY_HELP" :key="hk.key">
            <kbd>{{ hk.key }}</kbd>
            <span>{{ hk.desc }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, triggerRef, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch, defineComponent, h } from "vue";
import type {
  SymbolInfo,
  CandleInfo,
  CandleStructure,
  OpenInterestHistEntry,
  LongShortRatioEntry,
} from "@/core/interfacesv2";
import { klineDbUtilityV2 } from "@/utility/v2/klineDbUtilityV2";
import { getLiqudationHeatmap, type LiquidationHeatmapCell } from "@/utility/v2/analysis/liquidationHeatmap";
import { OrderMakerUtility } from "@/utility/OrderMakerUtility";
import { useNotificationStore } from "@/stores/notificationStore.ts";

// ── Dynamic candle detail renderer ─────────────────────────────────────
// Intentionally driven by the runtime object rather than CandleInfo's type
// definition. New CandleInfo properties therefore appear automatically.
const DynamicDetailSection = defineComponent({
  name: "DynamicDetailSection",
  props: {
    label: { type: String, required: true },
    value: { type: null as any, required: true },
    depth: { type: Number, default: 0 },
    accentIndex: { type: Number, default: 0 },
  },
  setup(props) {
    const renderValue = (value: unknown, key: string, depth: number): ReturnType<typeof h> => {
      if (value === null || value === undefined) {
        return h("span", { class: "detail-null" }, "—");
      }

      if (Array.isArray(value)) {
        if (value.length === 0) return h("span", { class: "detail-null" }, "[]");

        return h("div", { class: "detail-array" }, value.map((item, index) => {
          if (isPlainObject(item)) {
            return h("div", { class: "detail-array-object", key: index }, [
              h("div", { class: "detail-array-index" }, `[${index}]`),
              ...objectEntries(item).map(([childKey, childValue]) =>
                renderEntry(childKey, childValue, depth + 1)
              ),
            ]);
          }
          return h("div", { class: "detail-array-value", key: index }, [
            h("span", { class: "detail-array-index" }, `[${index}]`),
            renderPrimitive(item, key),
          ]);
        }));
      }

      if (isPlainObject(value)) {
        return h("div", { class: "detail-nested" }, objectEntries(value).map(([childKey, childValue]) =>
          renderEntry(childKey, childValue, depth + 1)
        ));
      }

      return renderPrimitive(value, key);
    };

    const renderEntry = (key: string, value: unknown, depth: number): ReturnType<typeof h> => {
      const complex = Array.isArray(value) || isPlainObject(value);
      return h("div", { class: complex ? "detail-complex-entry" : "detail-item" }, [
        h("label", { title: key }, formatDetailLabel(key)),
        renderValue(value, key, depth),
      ]);
    };

    const renderPrimitive = (value: unknown, key: string): ReturnType<typeof h> => {
      if (typeof value === "boolean") {
        return h("span", { class: ["boolean-badge", value ? "is-true" : "is-false"] }, value ? "TRUE" : "FALSE");
      }
      if (typeof value === "number") {
        return h("span", { class: "detail-number" }, formatDetailNumber(key, value));
      }
      if (typeof value === "string") {
        const isSignal = ["direction", "dominant"].includes(key.toLowerCase());
        return h("span", { class: isSignal ? "side-badge side-" + value.toLowerCase() : "detail-text" }, value);
      }
      return h("span", { class: "detail-text" }, String(value));
    };

    return () => h("div", {
      class: "detail-section dynamic-detail-section",
      style: { "--detail-depth": String(props.depth) },
    }, [
      h("h3", props.label),
      renderValue(props.value, props.label, props.depth),
    ]);
  },
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectEntries(value: unknown): [string, unknown][] {
  if (!isPlainObject(value)) return [];
  return Object.entries(value);
}

function formatDetailLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatDetailNumber(key: string, value: number): string {
  if (!Number.isFinite(value)) return String(value);

  const normalized = key.toLowerCase();
  if (normalized.includes("time") && Math.abs(value) >= 1_000_000_000_000) {
    return formatDateTime(value);
  }
  if (normalized.includes("ratio") || normalized.includes("confidence") || normalized.includes("location") || normalized.includes("penetration") || normalized.includes("distance") || normalized.includes("confirmation")) {
    return Math.abs(value) <= 1 ? pct(value) : value.toFixed(4);
  }
  if (["open", "close", "high", "low", "atr", "ema200", "level"].includes(normalized)) {
    return formatPrice(value);
  }
  return formatNumber(value);
}

// ── Props ──────────────────────────────────────────────────────────────
const props = withDefaults(defineProps<{
  symbol: string;
  overlayMode?: boolean;
}>(), {
  overlayMode: false,
});
const symbol = computed(() => props.symbol);
const overlayMode = computed(() => props.overlayMode);

// ── Data load ──────────────────────────────────────────────────────────
// shallowRef (not ref): SymbolInfo holds thousands of candles across four
// timeframes. A deep ref would make Vue proxy that entire nested structure,
// and every websocket tick mutates it in place (last.close = price, etc.) —
// with a deep ref that fires the full reactive graph (every computed that
// touches candlesByTf/displayCandles/crossTfEmaLines/overlayBoxes/propBars)
// on every single tick, which is what made live updates feel laggy. With
// shallowRef those in-place mutations are invisible to Vue until we
// explicitly opt in via triggerRef — which is batched below to once per
// animation frame instead of once per message.
const symbolInfo = shallowRef<SymbolInfo | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const livePrice = ref<number | null>(null);
let binanceWs: WebSocket | null = null;

// Coalesces any number of websocket ticks arriving within the same frame
// into a single reactive update, so heavy computed chains re-run at most
// once per ~16ms instead of once per message.
let pendingLivePrice: number | null = null;
let wsFrameQueued = false;
function flushWsFrame() {
  wsFrameQueued = false;
  if (pendingLivePrice != null) {
    livePrice.value = pendingLivePrice;
    pendingLivePrice = null;
  }
  if (symbolInfo.value) triggerRef(symbolInfo);
}
function queueWsFrame(price: number) {
  pendingLivePrice = price;
  if (wsFrameQueued) return;
  wsFrameQueued = true;
  requestAnimationFrame(flushWsFrame);
}

function closeBinanceWs() {
  if (binanceWs) {
    binanceWs.onopen = null;
    binanceWs.onmessage = null;
    binanceWs.onerror = null;
    binanceWs.onclose = null;
    binanceWs.close();
    binanceWs = null;
  }
}

// ── Cross-timeframe candle syncing ──────────────────────────────────────
// The websocket only streams the primary timeframe. When a new primary
// candle spawns (a new openTime shows up), the higher timeframes' cached
// arrays (candle_1h / candle_4h / candle_1d) need to stay in step too: if
// the new primary candle also starts a new higher-tf bucket, that candle is
// auto-created here; otherwise the still-forming higher-tf candle is
// updated live from the same price tick.
const TF_DURATION_MS: Record<Tf, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

function bucketOpenTime(tf: Tf, ts: number): number {
  const dur = TF_DURATION_MS[tf];
  return Math.floor(ts / dur) * dur;
}

function candlesArrayFor(info: SymbolInfo, tf: Tf): CandleInfo[] {
  const key = (`candle_${tf}` as unknown) as keyof SymbolInfo;
  if (!info[key]) (info[key] as unknown) = [];
  return info[key] as unknown as CandleInfo[];
}

function syncCrossTimeframeCandles(info: SymbolInfo, primaryOpenTime: number, price: number, high: number, low: number) {
  if (!Number.isFinite(primaryOpenTime)) return;
  for (const tf of TF_LIST) {
    if (tf === primaryTf.value) continue;
    const arr = candlesArrayFor(info, tf);
    const bucketOpen = bucketOpenTime(tf, primaryOpenTime);
    const last = arr[arr.length - 1];

    if (!last || bucketOpen > last.openTime) {
      // A new candle has spawned on this cross timeframe — auto-create it
      // so overlays and the XTF EMA line update immediately instead of
      // waiting for the next full IndexedDB refresh.
      const prevEma = last?.ema200;
      const alpha = 2 / 201;
      const seededEma = typeof prevEma === "number" && Number.isFinite(prevEma)
        ? prevEma + alpha * (price - prevEma)
        : price;
      arr.push({
        openTime: bucketOpen,
        closeTime: bucketOpen + TF_DURATION_MS[tf] - 1,
        open: price,
        high: Number.isFinite(high) ? high : price,
        low: Number.isFinite(low) ? low : price,
        close: price,
        volume: 0,
        atr: last?.atr,
        ema200: seededEma,
        candleStructure: { isBullish: true, isBearish: false },
        anchors: { avwap: { isAnchor: false }, frvp: { isAnchor: false }, liquidityHeatmap: { isAnchor: false } },
      } as unknown as CandleInfo);
    } else if (bucketOpen === last.openTime) {
      // Same forming candle on this timeframe — update it live from the tick.
      last.close = price;
      if (Number.isFinite(high)) last.high = Math.max(last.high, high);
      if (Number.isFinite(low)) last.low = Math.min(last.low, low);
      if (last.candleStructure) {
        last.candleStructure.isBullish = last.close >= last.open;
        last.candleStructure.isBearish = last.close < last.open;
      }
    }
  }
}

function connectBinanceWs() {
  closeBinanceWs();
  const streamSymbol = props.symbol.trim().toLowerCase();
  if (!streamSymbol) return;

  const ws = new WebSocket(`wss://fstream.binance.com/market/ws/${streamSymbol}@kline_${primaryTf.value}`);
  binanceWs = ws;

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      const k = payload?.k;
      if (!k || typeof k.c !== "string") return;

      const price = Number(k.c);
      if (!Number.isFinite(price)) return;
      queueWsFrame(price);

      const info = symbolInfo.value;
      if (!info) return;

      const candles = candlesArrayFor(info, primaryTf.value);
      const last = candles[candles.length - 1];
      const openTime = Number(k.t);
      const high = Number(k.h);
      const low = Number(k.l);
      const volume = Number(k.v);

      if (!Number.isFinite(openTime)) return;

      if (last && last.openTime === openTime) {
        last.close = price;
        if (Number.isFinite(high)) last.high = Math.max(last.high, high);
        if (Number.isFinite(low)) last.low = Math.min(last.low, low);
        last.closeTime = Number(k.T);
        if (Number.isFinite(volume)) last.volume = volume;
      } else if (!last || openTime > last.openTime) {
        // A new primary candle has spawned — append it so the chart keeps
        // moving forward instead of freezing on the last cached candle.
        candles.push({
          ...(last ?? {}),
          openTime,
          closeTime: Number.isFinite(Number(k.T)) ? Number(k.T) : openTime + TF_DURATION_MS[primaryTf.value] - 1,
          open: price,
          high: Number.isFinite(high) ? high : price,
          low: Number.isFinite(low) ? low : price,
          close: price,
          volume: Number.isFinite(volume) ? volume : 0,
        } as CandleInfo);
      }

      syncCrossTimeframeCandles(info, openTime, price, high, low);
    } catch (err) {
      console.warn("Binance futures websocket message parse failed:", err);
    }
  };

  ws.onerror = () => {
    // The browser may report transient websocket errors before reconnecting.
  };

  ws.onclose = () => {
    if (binanceWs === ws && !loading.value) {
      window.setTimeout(() => {
        if (binanceWs === ws) connectBinanceWs();
      }, 2000);
    }
  };
}

async function loadSymbolInfo() {
  loading.value = true;
  loadError.value = null;
  try {
    const info = await klineDbUtilityV2.getSymbolInfo(props.symbol);
    if (!info) {
      loadError.value = `No cached SymbolInfo for "${props.symbol}" in IndexedDB.`;
      symbolInfo.value = null;
    } else {
      symbolInfo.value = info;
    }
  } catch (err) {
    loadError.value = `Failed to read IndexedDB: ${(err as Error)?.message ?? err}`;
  } finally {
    loading.value = false;
  }
}

watch(() => props.symbol, () => {
  livePrice.value = null;
  resetView();
  loadSymbolInfo();
  connectBinanceWs();
});

// ── Timeframe selection ───────────────────────────────────────────────
type Tf = "15m" | "1h" | "4h" | "1d";
const TF_LIST: Tf[] = ["15m", "1h", "4h", "1d"];
const OVERLAY_TF_LIST: Tf[] = ["1h", "4h", "1d"];
// XTF EMA projects EVERY timeframe's EMA200 onto the chart, including the
// primary 15m one — kept separate from OVERLAY_TF_LIST because that list
// also drives the ghost-candle overlay chips, which should stay 1h/4h/1d.
const XTF_EMA_TF_LIST: Tf[] = ["15m", "1h", "4h", "1d"];
const primaryTf = ref<Tf>("15m");
const overlayFlags = reactive<Record<Tf, boolean>>({ "15m": false, "1h": false, "4h": false, "1d": false });

function setPrimaryTf(tf: Tf) {
  primaryTf.value = tf;
  livePrice.value = null;
  resetView();
  connectBinanceWs();
}

const candlesByTf = computed<Record<Tf, CandleInfo[]>>(() => ({
  "15m": symbolInfo.value?.candle_15m ?? [],
  "1h": symbolInfo.value?.candle_1h ?? [],
  "4h": symbolInfo.value?.candle_4h ?? [],
  "1d": symbolInfo.value?.candle_1d ?? [],
}));
const oiByTf = computed<Record<Tf, OpenInterestHistEntry[]>>(() => ({
  "15m": symbolInfo.value?.oi_15m ?? [],
  "1h": symbolInfo.value?.oi_1h ?? [],
  "4h": symbolInfo.value?.oi_4h ?? [],
  "1d": symbolInfo.value?.oi_1d ?? [],
}));
const lsByTf = computed<Record<Tf, LongShortRatioEntry[]>>(() => ({
  "15m": symbolInfo.value?.ls_15m ?? [],
  "1h": symbolInfo.value?.ls_1h ?? [],
  "4h": symbolInfo.value?.ls_4h ?? [],
  "1d": symbolInfo.value?.ls_1d ?? [],
}));

const primaryCandles = computed(() => candlesByTf.value[primaryTf.value]);
const primaryOi = computed(() => oiByTf.value[primaryTf.value]);
const primaryLs = computed(() => lsByTf.value[primaryTf.value]);

// ── View window (pan / zoom) ──────────────────────────────────────────
const BARS_PRESETS = [50, 80, 120, 160, 240, 320];
const visibleBars = ref(120);
const viewStartIndex = ref(0);
const yPanOffset = ref(0);
const maxVisibleBars = computed(() => Math.max(20, primaryCandles.value.length || 320));

function resetView() {
  viewStartIndex.value = Math.max(0, primaryCandles.value.length - visibleBars.value);
  yPanOffset.value = 0;
}

function scrollToLatest() {
  viewStartIndex.value = Math.max(0, primaryCandles.value.length - visibleBars.value);
  yPanOffset.value = 0;
}

const maxStartIndex = computed(() => Math.max(0, primaryCandles.value.length - 1));
const displayStart = computed(() => {
  const v = Math.floor(viewStartIndex.value);
  return Math.max(0, Math.min(v, Math.max(0, primaryCandles.value.length - 1)));
});
const displayEnd = computed(() => Math.min(primaryCandles.value.length, displayStart.value + Math.round(visibleBars.value)));
const displayCandles = computed(() => {
  const out: { gi: number; candle: CandleInfo }[] = [];
  for (let i = displayStart.value; i < displayEnd.value; i++) {
    out.push({ gi: i, candle: primaryCandles.value[i] });
  }
  return out;
});

// ── Layout / sizing ────────────────────────────────────────────────────
const chartContainer = ref<HTMLElement | null>(null);
const chartWidth = ref(900);
const chartHeight = ref(560);
let resizeObserver: ResizeObserver | null = null;

const PAD_LEFT = 4;
const PAD_RIGHT = 58;
const PAD_TOP = 10;
const PROP_HEIGHT = 60;
const SUBPLOT_GAP = 6;
const TIME_AXIS_HEIGHT = 20;
const FRVP_MAX_WIDTH = 90;

const plotWidth = computed(() => Math.max(50, chartWidth.value - PAD_RIGHT));
const subplotsHeight = computed(() => PROP_HEIGHT + SUBPLOT_GAP);
const mainPlotHeight = computed(() =>
  Math.max(80, chartHeight.value - PAD_TOP - subplotsHeight.value - TIME_AXIS_HEIGHT)
);

const candleWidth = computed(() => {
  const n = Math.max(1, Math.round(visibleBars.value));
  return Math.max(2, (plotWidth.value - PAD_LEFT * 2) / n);
});

function candleX(gi: number): number {
  return PAD_LEFT + (gi - displayStart.value) * candleWidth.value + candleWidth.value / 2;
}
function indexAtX(x: number): number {
  const gi = displayStart.value + Math.round((x - PAD_LEFT - candleWidth.value / 2) / candleWidth.value);
  return Math.max(0, Math.min(maxStartIndex.value, gi));
}

const priceRange = computed(() => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const { candle } of displayCandles.value) {
    if (candle.low < lo) lo = candle.low;
    if (candle.high > hi) hi = candle.high;
  }
  if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1 };
  const pad = (hi - lo) * 0.1 || Math.max(1, hi * 0.01);
  return { lo: lo - pad, hi: hi + pad };
});

function priceToY(price: number): number {
  const { lo, hi } = priceRange.value;
  const span = hi - lo || 1;
  return PAD_TOP + (1 - (price - lo) / span) * (mainPlotHeight.value - PAD_TOP) + yPanOffset.value;
}
function yToPrice(y: number): number {
  const { lo, hi } = priceRange.value;
  const span = hi - lo || 1;
  return lo + (1 - (y - PAD_TOP - yPanOffset.value) / (mainPlotHeight.value - PAD_TOP)) * span;
}

// ── Live price line ──────────────────────────────────────────────────────
// Bull/bear follows the forming candle's own open/close relationship (same
// signal that colors the last candle body), not a comparison against the
// previous tick — that keeps the line's color in sync with the candle it
// belongs to.
const livePriceBullish = computed(() => {
  const last = primaryCandles.value[primaryCandles.value.length - 1];
  return !!last?.candleStructure?.isBullish;
});
const livePriceLineY = computed<number | null>(() => {
  if (livePrice.value == null) return null;
  const y = priceToY(livePrice.value);
  if (!Number.isFinite(y) || y < 0 || y > mainPlotHeight.value) return null;
  return y;
});

const priceStep = computed(() => {
  const { lo, hi } = priceRange.value;
  const span = hi - lo;
  const raw = span / 200;
  return raw > 0 ? Number(raw.toPrecision(1)) : 0.01;
});

const priceGridLines = computed(() => {
  const { lo, hi } = priceRange.value;
  const lines: { y: number; price: number }[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const price = lo + ((hi - lo) * i) / steps;
    lines.push({ y: priceToY(price), price });
  }
  return lines;
});

const timeAxisTicks = computed(() => {
  const cands = displayCandles.value;
  if (cands.length === 0) return [];
  const every = Math.max(1, Math.round(cands.length / 8));
  const out: { gi: number; label: string }[] = [];
  for (let i = 0; i < cands.length; i += every) {
    out.push({ gi: cands[i].gi, label: formatAxisTime(cands[i].candle.openTime) });
  }
  return out;
});

// ── ResizeObserver ─────────────────────────────────────────────────────
function measureContainer() {
  if (!chartContainer.value) return;
  const rect = chartContainer.value.getBoundingClientRect();
  chartWidth.value = Math.max(200, rect.width);
  chartHeight.value = Math.max(240, rect.height);
}

// ── Pan / zoom interaction ─────────────────────────────────────────────
type Tool = "none" | "rectangle" | "line" | "horizontal-line" | "price-range" | "frvp" | "avwap" | "liquidity";
const activeTool = ref<Tool>("none");

const TOOL_DEFS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "rectangle", icon: "▭", label: "Rectangle", key: "r" },
  { id: "line", icon: "╱", label: "Trend line", key: "l" },
  { id: "horizontal-line", icon: "—", label: "Horizontal price line", key: "p" },
  { id: "price-range", icon: "↕", label: "Price range", key: "t" },
  { id: "frvp", icon: "▤", label: "Fixed-range volume profile", key: "v" },
  { id: "avwap", icon: "◇", label: "Anchored VWAP (click a candle)", key: "a" },
  { id: "liquidity", icon: "▦", label: "Liquidity heatmap (drag a range)", key: "h" },
];

function setActiveTool(t: Tool) {
  activeTool.value = activeTool.value === t ? "none" : t;
  toolDraft.value = null;
}

interface ToolDraft { startGi: number; startPrice: number; curGi: number; curPrice: number }
const toolDraft = ref<ToolDraft | null>(null);

let isPanning = false;
let panStart = { x: 0, y: 0, viewStartIndex: 0, yPanOffset: 0 };
let mouseDownAt = { x: 0, y: 0, t: 0 };

const hover = ref<{ x: number; y: number; price: number; gi: number } | null>(null);
const hoveredCandle = computed(() => {
  if (!hover.value) return null;
  return primaryCandles.value[hover.value.gi] ?? null;
});

function eventLocalPos(e: MouseEvent): { x: number; y: number } {
  const rect = chartContainer.value!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onChartMouseDown(e: MouseEvent) {
  if (loading.value || loadError.value) return;
  const { x, y } = eventLocalPos(e);
  mouseDownAt = { x, y, t: performance.now() };
  const gi = indexAtX(x);
  const price = yToPrice(y);

  if (activeTool.value === "none") {
    isPanning = true;
    panStart = { x, y, viewStartIndex: viewStartIndex.value, yPanOffset: yPanOffset.value };
  } else if (["rectangle", "line", "price-range", "frvp", "liquidity"].includes(activeTool.value)) {
    toolDraft.value = { startGi: gi, startPrice: price, curGi: gi, curPrice: price };
  }
  // Horizontal price lines, AVWAP and preview buy/sell are click-to-place tools.
}

function onChartMouseMove(e: MouseEvent) {
  if (!chartContainer.value || loading.value || loadError.value) return;
  const { x, y } = eventLocalPos(e);
  const gi = indexAtX(x);
  hover.value = { x, y, gi, price: yToPrice(y) };

  if (isPanning) {
    const dx = x - panStart.x;
    const dy = y - panStart.y;
    viewStartIndex.value = clamp(
      panStart.viewStartIndex - dx / candleWidth.value,
      0,
      Math.max(0, primaryCandles.value.length - visibleBars.value)
    );
    yPanOffset.value = panStart.yPanOffset + dy;
  } else if (toolDraft.value) {
    toolDraft.value.curGi = gi;
    toolDraft.value.curPrice = yToPrice(y);
    if (activeTool.value === "liquidity") recomputeLiquidityPreview();
  }
}

function onChartMouseLeave() {
  hover.value = null;
}

function onChartMouseUp(e: MouseEvent) {
  const { x, y } = eventLocalPos(e);
  const movedFar = Math.hypot(x - mouseDownAt.x, y - mouseDownAt.y) > 4;

  if (isPanning) {
    isPanning = false;
    if (!movedFar) handleChartClick(x, y);
    return;
  }

  // Click-only tools (AVWAP and preview buy/sell) never enter the pan state.
  // Handle their click here so a candle click actually creates the tool.
  if (!toolDraft.value && !movedFar && ["horizontal-line", "avwap"].includes(activeTool.value)) {
    handleChartClick(x, y);
    return;
  }

  if (toolDraft.value) {
    const d = toolDraft.value;
    const giSpan = Math.abs(d.curGi - d.startGi);
    const priceSpan = Math.abs(d.curPrice - d.startPrice);
    if (giSpan >= 1 || priceSpan > 0) {
      finalizeToolDraft(d);
    }
    toolDraft.value = null;
    activeTool.value = "none";
  }
}

function handleChartClick(x: number, y: number) {
  const gi = indexAtX(x);
  const price = yToPrice(y);

  if (activeTool.value === "horizontal-line") {
    horizontalLines.value.push({ id: nextId(), price });
    activeTool.value = "none";
  } else if (activeTool.value === "avwap") {
    addAvwapAnchor(gi);
    activeTool.value = "none";
  } else if (activeTool.value === "none") {
    onCandleClick(gi);
  }
}

function onChartDoubleClick() {
  yPanOffset.value = 0;
  scrollToLatest();
}

function onWheel(e: WheelEvent) {
  if (loading.value || loadError.value || primaryCandles.value.length === 0) return;
  const { x } = eventLocalPos(e);
  const giUnderCursor = indexAtX(x);
  const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
  const next = clamp(Math.round(visibleBars.value * factor), 20, Math.max(20, primaryCandles.value.length));
  visibleBars.value = next;
  nextTick(() => {
    const fraction = (x - PAD_LEFT) / (plotWidth.value - PAD_LEFT * 2);
    viewStartIndex.value = clamp(
      giUnderCursor - fraction * visibleBars.value,
      0,
      Math.max(0, primaryCandles.value.length - visibleBars.value)
    );
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Candle click → modal ───────────────────────────────────────────────
const selectedCandle = ref<{ gi: number; candle: CandleInfo } | null>(null);

function onCandleClick(gi: number) {
  const candle = primaryCandles.value[gi];
  if (!candle) return;
  selectedCandle.value = { gi, candle };
}

const selectedCandleOi = computed<OpenInterestHistEntry | null>(() => {
  if (!selectedCandle.value) return null;
  return nearestByTime(primaryOi.value, selectedCandle.value.candle.closeTime);
});
const selectedCandleLs = computed<LongShortRatioEntry | null>(() => {
  if (!selectedCandle.value) return null;
  return nearestByTime(primaryLs.value, selectedCandle.value.candle.closeTime);
});

function nearestByTime<T extends { timestamp: number }>(entries: T[], ts: number): T | null {
  if (!entries || entries.length === 0) return null;
  // Entries are assumed chronologically sorted, same as the candle arrays.
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].timestamp < ts) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const prev = entries[lo - 1];
    const cur = entries[lo];
    if (Math.abs(prev.timestamp - ts) <= Math.abs(cur.timestamp - ts)) return prev;
  }
  return entries[lo];
}

function structureFlags(s: CandleStructure): string[] {
  const flags: string[] = [];
  if (s.isDoji) flags.push("doji");
  if (s.isExpansion) flags.push("expansion");
  if (s.isCompression) flags.push("compression");
  if (s.isInsideBar) flags.push("inside bar");
  if (s.isOutsideBar) flags.push("outside bar");
  if (s.isBullishEngulfing) flags.push("bull engulf");
  if (s.isBearishEngulfing) flags.push("bear engulf");
  return flags;
}

// ── Dynamic numeric-property subplot ───────────────────────────────────
// Replaces the old fixed OI / LS ratio bars: any numeric field on a candle
// can be plotted below the chart. Selection persists across sessions.
const PROP_STORAGE_KEY = "cev2.subplotProp";
const NON_PLOTTABLE_PROPS = new Set(["openTime", "closeTime"]);
const MAX_PROP_SCAN_DEPTH = 4;

// Recursively walks a candle (and its nested objects — candleStructure,
// anchors, etc.) collecting dot-paths of every numeric leaf, e.g.
// "candleStructure.bodyRatio" or "anchors.avwap.isAnchor" (if numeric).
// Arrays are skipped (heatmap cell lists etc. aren't meaningful as a single
// scalar per candle), and objects are only descended into, never added
// themselves.
function collectNumericPaths(obj: unknown, prefix: string, keys: Set<string>, depth: number): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > MAX_PROP_SCAN_DEPTH) return;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (depth === 0 && NON_PLOTTABLE_PROPS.has(k)) continue;
    const v = (obj as Record<string, unknown>)[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v)) {
      keys.add(path);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      collectNumericPaths(v, path, keys, depth + 1);
    }
  }
}

// Reads a (possibly dot-nested) path off a candle, e.g. getByPath(candle,
// "candleStructure.bodyRatio"). Returns undefined if any segment is missing.
function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const availableNumericProps = computed<string[]>(() => {
  const candles = primaryCandles.value;
  const keys = new Set<string>();
  const sampleCount = Math.min(candles.length, 40);
  for (let i = candles.length - sampleCount; i < candles.length; i++) {
    const c = candles[i] as unknown as Record<string, unknown>;
    if (!c) continue;
    collectNumericPaths(c, "", keys, 0);
  }
  if (keys.size === 0) keys.add("volume");
  return Array.from(keys).sort();
});

function loadStoredProp(): string {
  try {
    return window.localStorage.getItem(PROP_STORAGE_KEY) || "volume";
  } catch {
    return "volume";
  }
}

const selectedProp = ref<string>(loadStoredProp());
const propMenuOpen = ref(false);
const propSearch = ref("");
const propSelectRef = ref<HTMLElement | null>(null);

const filteredProps = computed(() => {
  const q = propSearch.value.trim().toLowerCase();
  const all = availableNumericProps.value;
  if (!q) return all;
  return all.filter((p) => p.toLowerCase().includes(q));
});

function selectProp(p: string) {
  selectedProp.value = p;
  propMenuOpen.value = false;
  propSearch.value = "";
  try {
    window.localStorage.setItem(PROP_STORAGE_KEY, p);
  } catch {
    // localStorage may be unavailable (private mode, etc.) — selection still
    // works for the current session, it just won't persist.
  }
}

function onDocumentClickForPropSelect(e: MouseEvent) {
  if (!propMenuOpen.value) return;
  const el = propSelectRef.value;
  if (el && !el.contains(e.target as Node)) propMenuOpen.value = false;
}

const propBars = computed(() => {
  const key = selectedProp.value;
  const matched = displayCandles.value.map((c) => ({
    gi: c.gi,
    v: Number(getByPath(c.candle, key)),
  }));
  const max = Math.max(1, ...matched.map((m) => (Number.isFinite(m.v) ? Math.abs(m.v) : 0)));
  return matched
    .filter((m) => Number.isFinite(m.v))
    .map((m) => ({ gi: m.gi, h: (Math.abs(m.v) / max) * (PROP_HEIGHT - 12) }));
});

// ── Multi-timeframe ghost candle overlays ──────────────────────────────
interface OverlayBox { id: string; x1: number; x2: number; open: number; high: number; low: number; close: number; bullish: boolean }

const overlayBoxes = computed<Record<Tf, OverlayBox[]>>(() => {
  const result: Record<Tf, OverlayBox[]> = { "15m": [], "1h": [], "4h": [], "1d": [] };
  if (displayCandles.value.length === 0) return result;
  const windowStartTime = displayCandles.value[0].candle.openTime;
  const windowEndTime = displayCandles.value[displayCandles.value.length - 1].candle.closeTime;

  for (const tf of OVERLAY_TF_LIST) {
    if (!overlayFlags[tf]) continue;
    const tfCandles = candlesByTf.value[tf];
    for (const tc of tfCandles) {
      if (tc.closeTime < windowStartTime || tc.openTime > windowEndTime) continue;
      const firstGi = displayCandles.value.find((c) => c.candle.openTime >= tc.openTime)?.gi;
      const lastCand = [...displayCandles.value].reverse().find((c) => c.candle.closeTime <= tc.closeTime);
      const startGi = firstGi ?? displayCandles.value[0].gi;
      const endGi = lastCand?.gi ?? startGi;
      result[tf].push({
        id: `${tf}-${tc.openTime}`,
        x1: candleX(startGi) - candleWidth.value / 2,
        x2: candleX(endGi) + candleWidth.value / 2,
        open: tc.open,
        high: tc.high,
        low: tc.low,
        close: tc.close,
        bullish: !!tc.candleStructure?.isBullish,
      });
    }
  }
  return result;
});

// ── Cross-TF EMA ────────────────────────────────────────────────────────
// Projects each higher timeframe's EMA200 (SymbolInfo.candle_<tf>[].ema200)
// onto the primary chart. Matching is done by openTime — the higher-tf
// candle whose bucket the primary candle currently falls in — rather than
// gating on closeTime, so the still-forming (most recent) higher-tf candle's
// EMA is included too. The old closeTime-based gate excluded exactly that
// candle, which is why lines were missing across the default (latest-bars)
// view.
const crossTfEmaLines = computed<Record<Tf, { gi: number; price: number }[]>>(() => {
  const result: Record<Tf, { gi: number; price: number }[]> = { "15m": [], "1h": [], "4h": [], "1d": [] };
  if (!showCrossTfEma.value) return result;
  for (const tf of XTF_EMA_TF_LIST) {
    if (tf === primaryTf.value) continue;
    const tfCandles = candlesByTf.value[tf];
    if (tfCandles.length === 0) continue;
    let j = 0;
    const pts: { gi: number; price: number }[] = [];
    for (const { gi, candle } of displayCandles.value) {
      while (j + 1 < tfCandles.length && tfCandles[j + 1].openTime <= candle.openTime) j++;
      const src = tfCandles[j];
      if (src && src.openTime <= candle.openTime && typeof src.ema200 === "number" && Number.isFinite(src.ema200)) {
        pts.push({ gi, price: src.ema200 });
      }
    }
    result[tf] = pts;
  }
  return result;
});
const showCrossTfEma = ref(false);

// ── Liquidity heatmap tool ─────────────────────────────────────────────


function getRangeHighLow(start: number, end: number) {
  const slice = primaryCandles.value.slice(start, end + 1);
  let low = Infinity;
  let high = -Infinity;
  for (const c of slice) {
    low = Math.min(low, c.low);
    high = Math.max(high, c.high);
  }
  return { low, high };
}

function computeLiquidityRange(start: number, end: number): LiquidityRange | null {
  const slice = primaryCandles.value.slice(start, end + 1);
  if (!slice.length) return null;
  const result = getLiqudationHeatmap(slice);
  const { low, high } = getRangeHighLow(start, end);
  return {
    id: nextId(),
    startGi: start,
    endGi: end,
    low,
    high,
    cells: result?.cells ?? [],
  };
}

function recomputeLiquidityPreview() {
  // Preview is rendered by toolDraft; no persistent mutation until mouseup.
}

function finalizeLiquidity(d: ToolDraft) {
  const start = Math.min(d.startGi, d.curGi);
  const end = Math.max(d.startGi, d.curGi);
  const range = computeLiquidityRange(start, end);
  if (range) liquidityRanges.value.push(range);
}

// ── Rectangle / line / price-range / FRVP drawings ─────────────────────
interface RectShape { id: string; x1: number; x2: number; y1: number; y2: number }
interface LineShape { id: string; x1: number; x2: number; y1: number; y2: number }
interface HorizontalLineShape { id: string; price: number }
interface PriceRangeBox { id: string; x1: number; x2: number; y1: number; y2: number }
interface FrvpRow { priceLow: number; priceHigh: number; buyVolume: number; sellVolume: number; buyFrac: number; sellFrac: number }
interface FrvpZone {
  id: string; startGi: number; endGi: number;
  rangeLow: number; rangeHigh: number;
  rows: FrvpRow[]; poc: number; maxVol: number;
}
interface AvwapLine { id: string; anchorGi: number; points: { gi: number; price: number }[] }
interface LiquidityRange {
  id: string; startGi: number; endGi: number; low: number; high: number; cells: LiquidationHeatmapCell[];
}
interface PreviewPosition { side: "buy" | "sell"; entryGi: number; entryPrice: number; tp: number; sl: number }

const rectangles = ref<RectShape[]>([]);
const trendLines = ref<LineShape[]>([]);
const horizontalLines = ref<HorizontalLineShape[]>([]);
const priceRangeBoxes = ref<PriceRangeBox[]>([]);
const frvpZones = ref<FrvpZone[]>([]);
const avwapLines = ref<AvwapLine[]>([]);
const liquidityRanges = ref<LiquidityRange[]>([]);
const previewPosition = ref<PreviewPosition | null>(null);
const selectedDrawing = ref<{ type: "rectangle" | "line" | "horizontal-line" | "price-range" | "frvp" | "avwap" | "liquidity"; id: string } | null>(null);

const previewMargin = ref(5);
const targetTpRoi = ref(2);
const targetSlRoi = ref(2);
const previewLoading = ref(false);
const pendingSide = ref<"LONG" | "SHORT" | null>(null);
const placingOrder = ref(false);
const previewError = ref<string | null>(null);

// Draggable preview panel. null means use the centered default position.
const previewPanelPosition = ref<{ x: number | null; y: number | null }>({ x: null, y: null });

const previewPanelStyle = computed(() => {
  if (previewPanelPosition.value.x == null || previewPanelPosition.value.y == null) return {};
  return {
    left: `${previewPanelPosition.value.x}px`,
    top: `${previewPanelPosition.value.y}px`,
    transform: "translate(-50%, -50%)",
  };
});

function resetPreviewPanelPosition() {
  previewPanelPosition.value = { x: null, y: null };
}

function startPreviewPanelDrag(event: MouseEvent) {
  if (!chartContainer.value) return;
  event.preventDefault();
  event.stopPropagation();

  const rect = chartContainer.value.getBoundingClientRect();
  const startClientX = event.clientX;
  const startClientY = event.clientY;

  const initialX = previewPanelPosition.value.x ?? rect.width / 2;
  const initialY = previewPanelPosition.value.y ?? rect.height / 2;

  const move = (e: MouseEvent) => {
    previewPanelPosition.value = {
      x: clamp(initialX + (e.clientX - startClientX), 90, Math.max(90, rect.width - 90)),
      y: clamp(initialY + (e.clientY - startClientY), 80, Math.max(80, rect.height - 80)),
    };
  };

  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };

  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

function finalizeToolDraft(d: ToolDraft) {
  switch (activeTool.value) {
    case "rectangle":
      rectangles.value.push({ id: nextId(), x1: d.startGi, x2: d.curGi, y1: d.startPrice, y2: d.curPrice });
      break;
    case "line":
      trendLines.value.push({ id: nextId(), x1: d.startGi, x2: d.curGi, y1: d.startPrice, y2: d.curPrice });
      break;
    case "price-range":
      priceRangeBoxes.value.push({ id: nextId(), x1: d.startGi, x2: d.curGi, y1: d.startPrice, y2: d.curPrice });
      break;
    case "frvp":
      addFrvpZone(Math.min(d.startGi, d.curGi), Math.max(d.startGi, d.curGi));
      break;
    case "liquidity":
      finalizeLiquidity(d);
      break;
  }
}

// The FRVP profile must stay left-aligned and fully inside its range box, so
// its on-screen width is capped to the box's own current pixel width (which
// changes with zoom/pan) instead of always using the fixed max width.
function frvpProfileWidth(zone: FrvpZone): number {
  const minGi = Math.min(zone.startGi, zone.endGi);
  const maxGi = Math.max(zone.startGi, zone.endGi);
  const boxWidth = candleX(maxGi) - candleX(minGi) + candleWidth.value;
  return Math.min(FRVP_MAX_WIDTH, Math.max(4, boxWidth));
}

function addFrvpZone(startGi: number, endGi: number, existingId?: string) {
  const sGi = Math.max(0, Math.min(startGi, endGi));
  const eGi = Math.min(maxStartIndex.value, Math.max(startGi, endGi));
  const slice = primaryCandles.value.slice(sGi, eGi + 1);
  if (slice.length < 1) return;

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of slice) {
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
  }
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return;

  const buckets = 24;
  const bucketHeight = (hi - lo) / buckets;
  const raw = Array.from({ length: buckets }, (_, idx) => ({
    priceLow: lo + idx * bucketHeight,
    priceHigh: lo + (idx + 1) * bucketHeight,
    buyVolume: 0,
    sellVolume: 0,
  }));

  for (const c of slice) {
    const low = c.low;
    const high = c.high;
    const vol = c.volume ?? 0;
    if (vol <= 0 || high <= low) continue;
    const isBull = (c.close ?? 0) >= (c.open ?? 0);
    for (const b of raw) {
      const overlapLow = Math.max(low, b.priceLow);
      const overlapHigh = Math.min(high, b.priceHigh);
      if (overlapHigh <= overlapLow) continue;
      const v = vol * ((overlapHigh - overlapLow) / (high - low));
      if (isBull) b.buyVolume += v;
      else b.sellVolume += v;
    }
  }

  const maxVol = Math.max(1, ...raw.map(b => b.buyVolume + b.sellVolume));
  const pocIdx = raw.reduce((best, b, i) =>
    (b.buyVolume + b.sellVolume) > (raw[best].buyVolume + raw[best].sellVolume) ? i : best, 0);

  // Widths are stored as fractions (0..1) of the profile's max on-screen
  // width rather than raw pixels, so the profile always renders left-aligned
  // and fully inside the range box regardless of current zoom/pan.
  const rows = raw.map(b => {
    const total = b.buyVolume + b.sellVolume;
    const totalFrac = total / maxVol;
    const buyFrac = total > 0 ? totalFrac * (b.buyVolume / total) : 0;
    const sellFrac = totalFrac - buyFrac;
    return { ...b, buyFrac, sellFrac };
  });

  const id = existingId ?? nextId();
  const zone: FrvpZone = {
    id, startGi: sGi, endGi: eGi, rangeLow: lo, rangeHigh: hi,
    rows, poc: (raw[pocIdx].priceLow + raw[pocIdx].priceHigh) / 2, maxVol,
  };
  const idx = frvpZones.value.findIndex(z => z.id === id);
  if (idx >= 0) frvpZones.value[idx] = zone;
  else frvpZones.value.push(zone);
}
function addAvwapAnchor(anchorGi: number, existingId?: string) {
  const all = primaryCandles.value;
  if (!all[anchorGi]) return;
  let cumPV = 0;
  let cumVol = 0;
  const points: { gi: number; price: number }[] = [];
  for (let i = anchorGi; i < all.length; i++) {
    const c = all[i];
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * (c.volume ?? 0);
    cumVol += c.volume ?? 0;
    if (cumVol > 0) points.push({ gi: i, price: cumPV / cumVol });
  }
  const id = existingId ?? nextId();
  const next = { id, anchorGi, points };
  const idx = avwapLines.value.findIndex(x => x.id === id);
  if (idx >= 0) avwapLines.value[idx] = next;
  else avwapLines.value.push(next);
}

function clearAllDrawings() {
  rectangles.value = [];
  trendLines.value = [];
  horizontalLines.value = [];
  priceRangeBoxes.value = [];
  frvpZones.value = [];
  avwapLines.value = [];
  liquidityRanges.value = [];
  previewPosition.value = null;
  selectedDrawing.value = null;
}


// ── Post-placement drawing selection / editing ─────────────────────────
type DrawingType = "rectangle" | "line" | "horizontal-line" | "price-range" | "frvp" | "avwap" | "liquidity";

function selectDrawing(type: DrawingType, id: string) {
  selectedDrawing.value = { type, id };
}

function isDrawingSelected(type: DrawingType, id: string) {
  return selectedDrawing.value?.type === type && selectedDrawing.value?.id === id;
}

function removeDrawing(type: DrawingType, id: string) {
  if (type === "rectangle") rectangles.value = rectangles.value.filter(x => x.id !== id);
  if (type === "line") trendLines.value = trendLines.value.filter(x => x.id !== id);
  if (type === "horizontal-line") horizontalLines.value = horizontalLines.value.filter(x => x.id !== id);
  if (type === "price-range") priceRangeBoxes.value = priceRangeBoxes.value.filter(x => x.id !== id);
  if (type === "frvp") frvpZones.value = frvpZones.value.filter(x => x.id !== id);
  if (type === "avwap") avwapLines.value = avwapLines.value.filter(x => x.id !== id);
  if (type === "liquidity") liquidityRanges.value = liquidityRanges.value.filter(x => x.id !== id);
  if (selectedDrawing.value?.type === type && selectedDrawing.value.id === id) selectedDrawing.value = null;
}

function chartPointFromClient(clientX: number, clientY: number) {
  const rect = chartContainer.value?.getBoundingClientRect();
  if (!rect) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return { x, y, gi: indexAtX(x), price: yToPrice(y) };
}

function startDrawingMove(type: DrawingType, id: string, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const start = chartPointFromClient(event.clientX, event.clientY);
  if (!start) return;

  const getShape = () => {
    if (type === "rectangle") return rectangles.value.find(x => x.id === id);
    if (type === "line") return trendLines.value.find(x => x.id === id);
    if (type === "horizontal-line") return horizontalLines.value.find(x => x.id === id);
    if (type === "price-range") return priceRangeBoxes.value.find(x => x.id === id);
    return null;
  };
  const shape = getShape() as RectShape | LineShape | PriceRangeBox | undefined;
  if (!shape) return;

  const startGi = start.gi;
  const startPrice = start.price;
  const original = { ...shape };

  const move = (e: MouseEvent) => {
    const cur = chartPointFromClient(e.clientX, e.clientY);
    if (!cur) return;
    const dGi = cur.gi - startGi;
    const dPrice = cur.price - startPrice;
    if ("x1" in shape) {
      shape.x1 = original.x1 + dGi;
      shape.x2 = original.x2 + dGi;
      shape.y1 = original.y1 + dPrice;
      shape.y2 = original.y2 + dPrice;
    }
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  selectDrawing(type, id);
}

function startDrawingResize(
  type: "rectangle" | "price-range",
  id: string,
  edge: "left" | "right" | "top" | "bottom",
  event: MouseEvent
) {
  event.preventDefault();
  event.stopPropagation();
  const shape = type === "rectangle"
    ? rectangles.value.find(x => x.id === id)
    : priceRangeBoxes.value.find(x => x.id === id);
  if (!shape) return;

  const original = { ...shape };
  // The handles are always rendered at the shape's true visual extremes
  // (Math.min/Math.max of x1/x2 and y1/y2 — see the template), regardless of
  // which raw field (x1 vs x2, y1 vs y2) happens to hold that extreme. That
  // depends on which direction the shape was originally dragged out. So the
  // resize logic here has to resolve the same way, or a shape drawn "backwards"
  // (e.g. bottom-to-top) would have its "top" handle secretly wired to update
  // the y2 field while being drawn at the y1 position — dragging it would then
  // pull the *other* edge in and collapse the shape to zero height/width.
  const x1IsLeft = original.x1 <= original.x2;
  const y1IsTop = original.y1 >= original.y2;
  const priceEps = Math.max(Math.abs(original.y1 - original.y2) * 1e-6, 1e-6);

  const move = (e: MouseEvent) => {
    const cur = chartPointFromClient(e.clientX, e.clientY);
    if (!cur) return;
    if (edge === "left") {
      const otherGi = x1IsLeft ? original.x2 : original.x1;
      const newLeft = Math.min(cur.gi, otherGi - 1);
      if (x1IsLeft) shape.x1 = newLeft; else shape.x2 = newLeft;
    } else if (edge === "right") {
      const otherGi = x1IsLeft ? original.x1 : original.x2;
      const newRight = Math.max(cur.gi, otherGi + 1);
      if (x1IsLeft) shape.x2 = newRight; else shape.x1 = newRight;
    } else if (edge === "top") {
      const otherPrice = y1IsTop ? original.y2 : original.y1;
      const newTop = Math.max(cur.price, otherPrice + priceEps);
      if (y1IsTop) shape.y1 = newTop; else shape.y2 = newTop;
    } else {
      const otherPrice = y1IsTop ? original.y1 : original.y2;
      const newBottom = Math.min(cur.price, otherPrice - priceEps);
      if (y1IsTop) shape.y2 = newBottom; else shape.y1 = newBottom;
    }
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  selectDrawing(type, id);
}

function startLineEndpointResize(id: string, endpoint: "start" | "end", event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const line = trendLines.value.find(x => x.id === id);
  if (!line) return;
  const move = (e: MouseEvent) => {
    const cur = chartPointFromClient(e.clientX, e.clientY);
    if (!cur) return;
    if (endpoint === "start") {
      line.x1 = cur.gi;
      line.y1 = cur.price;
    } else {
      line.x2 = cur.gi;
      line.y2 = cur.price;
    }
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  selectDrawing("line", id);
}

function startFrvpResize(id: string, side: "left" | "right", event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const zone = frvpZones.value.find(x => x.id === id);
  if (!zone) return;
  const fixed = side === "left" ? zone.endGi : zone.startGi;
  const move = (e: MouseEvent) => {
    const cur = chartPointFromClient(e.clientX, e.clientY);
    if (!cur) return;
    if (side === "left") {
      zone.startGi = Math.min(cur.gi, fixed - 1);
    } else {
      zone.endGi = Math.max(cur.gi, fixed + 1);
    }
    addFrvpZone(zone.startGi, zone.endGi, zone.id);
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  selectDrawing("frvp", id);
}

function startLiquidityResize(id: string, side: "left" | "right", event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const range = liquidityRanges.value.find(x => x.id === id);
  if (!range) return;
  const fixed = side === "left" ? range.endGi : range.startGi;

  const move = (e: MouseEvent) => {
    const cur = chartPointFromClient(e.clientX, e.clientY);
    if (!cur) return;
    const start = side === "left" ? Math.min(cur.gi, fixed - 1) : range.startGi;
    const end = side === "right" ? Math.max(cur.gi, fixed + 1) : range.endGi;
    const next = computeLiquidityRange(start, end);
    if (next) {
      next.id = id;
      const idx = liquidityRanges.value.findIndex(x => x.id === id);
      if (idx >= 0) liquidityRanges.value[idx] = next;
    }
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  selectDrawing("liquidity", id);
}

function startHorizontalLineMove(id: string, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const line = horizontalLines.value.find(x => x.id === id);
  if (!line) return;
  const move = (e: MouseEvent) => {
    const cur = chartPointFromClient(e.clientX, e.clientY);
    if (!cur) return;
    line.price = cur.price;
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  selectDrawing("horizontal-line", id);
}

function startAvwapResize(id: string, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const line = avwapLines.value.find(x => x.id === id);
  if (!line) return;
  const move = (e: MouseEvent) => {
    const cur = chartPointFromClient(e.clientX, e.clientY);
    if (!cur) return;
    const candle = primaryCandles.value[cur.gi];
    if (!candle) return;
    addAvwapAnchor(cur.gi, id);
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  selectDrawing("avwap", id);
}

// ── Preview buy/sell / order ───────────────────────────────────────────
async function runPreview(side: "LONG" | "SHORT", apiSide: "BUY" | "SELL") {
  const visible = displayCandles.value;
  const reference = visible[visible.length - 1];
  if (!reference?.candle) {
    previewError.value = "No candle available for preview.";
    return;
  }
  previewError.value = null;
  previewLoading.value = true;
  pendingSide.value = side;
  try {
    const tpSl = await OrderMakerUtility.calculateTpSl(
      previewMargin.value,
      props.symbol,
      apiSide,
      String(reference.candle.close),
      targetTpRoi.value,
      targetSlRoi.value
    );
    resetPreviewPanelPosition();
    previewPosition.value = {
      side: side === "LONG" ? "buy" : "sell",
      entryGi: reference.gi,
      entryPrice: reference.candle.close,
      tp: Number(tpSl.tp_price),
      sl: Number(tpSl.sl_price),
    };
    activeTool.value = "none";
  } catch (error) {
    console.error("Preview TP/SL calculation failed:", error);
    previewError.value = "Failed to calculate TP/SL. Please try again.";
  } finally {
    previewLoading.value = false;
    pendingSide.value = null;
  }
}

const previewBuy = () => runPreview("LONG", "BUY");
const previewSell = () => runPreview("SHORT", "SELL");

async function placeOrder() {
  const pos = previewPosition.value;
  if (!pos || placingOrder.value) return;
  const reward = pos.side === "buy" ? pos.tp - pos.entryPrice : pos.entryPrice - pos.tp;
  const risk = pos.side === "buy" ? pos.entryPrice - pos.sl : pos.sl - pos.entryPrice;
  if (risk <= 0 || reward <= 0) {
    previewError.value = "Invalid TP/SL. TP must be beyond entry and SL must be on the opposite side.";
    return;
  }
  placingOrder.value = true;
  previewError.value = null;
  try {
    await OrderMakerUtility.openOrder(
      props.symbol,
      previewMargin.value,
      pos.side === "buy" ? "BUY" : "SELL",
      pos.tp,
      pos.sl
    );
    useNotificationStore().showNotification(
      "success",
      "top-right",
      "Order",
      `${pos.side === "buy" ? "LONG" : "SHORT"} Order Created`
    );
  } catch (error) {
    console.error("Failed to place order:", error);
    previewError.value = "Failed to place order. Please try again.";
  } finally {
    placingOrder.value = false;
  }
}

const previewRR = computed(() => {
  if (!previewPosition.value) return "—";
  const p = previewPosition.value;
  const reward = p.side === "buy" ? p.tp - p.entryPrice : p.entryPrice - p.tp;
  const risk = p.side === "buy" ? p.entryPrice - p.sl : p.sl - p.entryPrice;
  return risk > 0 ? `${(reward / risk).toFixed(2)} : 1` : "—";
});

function startPreviewPriceDrag(which: "tp" | "sl", event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (!previewPosition.value) return;
  const move = (e: MouseEvent) => {
    const cur = chartPointFromClient(e.clientX, e.clientY);
    if (!cur || !previewPosition.value) return;
    previewPosition.value[which] = cur.price;
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

// ── Formatting helpers ─────────────────────────────────────────────────
function formatPrice(v: number | undefined | null): string {
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function formatNumber(v: number | undefined | null): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function pct(v: number | undefined | null): string {
  if (v == null || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
function formatAxisTime(ts: number): string {
  const d = new Date(ts);
  if (primaryTf.value === "1d") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function formatPriceRangeLabel(pr: PriceRangeBox): string {
  const delta = pr.y2 - pr.y1;
  const pctDelta = pr.y1 !== 0 ? (delta / pr.y1) * 100 : 0;
  const bars = Math.abs(pr.x2 - pr.x1);
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${formatPrice(delta)} (${sign}${pctDelta.toFixed(2)}%) · ${bars} bars`;
}

// ── Hotkeys ─────────────────────────────────────────────────────────────
const showHotkeysModal = ref(false);
const HOTKEY_HELP = [
  { key: "R", desc: "Rectangle tool" },
  { key: "L", desc: "Trend line tool (click-drag)" },
  { key: "P", desc: "Horizontal price line (click to place)" },
  { key: "T", desc: "Price range (measure) tool" },
  { key: "V", desc: "Fixed-range volume profile" },
  { key: "A", desc: "Anchored VWAP (click a candle)" },
  { key: "H", desc: "Liquidity heatmap (drag a range)" },
  { key: "1 / 2 / 3", desc: "Toggle 1H / 4H / 1D overlay candles" },
  { key: "E", desc: "Reset view to latest candle" },
  { key: "X", desc: "Toggle cross-TF EMA" },
  { key: "C", desc: "Clear all drawings" },
  { key: "Esc", desc: "Cancel active tool / close dialogs" },
  { key: "?", desc: "Show this help" },
];

function onKeydown(e: KeyboardEvent) {
  if (overlayMode.value) return;
  const target = e.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case "r": setActiveTool("rectangle"); break;
    case "l": setActiveTool("line"); break;
    case "p": setActiveTool("horizontal-line"); break;
    case "t": setActiveTool("price-range"); break;
    case "v": setActiveTool("frvp"); break;
    case "a": setActiveTool("avwap"); break;
    case "h": setActiveTool("liquidity"); break;
    case "1": overlayFlags["1h"] = !overlayFlags["1h"]; break;
    case "2": overlayFlags["4h"] = !overlayFlags["4h"]; break;
    case "3": overlayFlags["1d"] = !overlayFlags["1d"]; break;
    case "e": scrollToLatest(); break;
    case "x": showCrossTfEma.value = !showCrossTfEma.value; break;
    case "c": clearAllDrawings(); break;
    case "?": showHotkeysModal.value = true; break;
    case "escape":
      activeTool.value = "none";
      toolDraft.value = null;
      selectedCandle.value = null;
      showHotkeysModal.value = false;
      propMenuOpen.value = false;
      break;
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────
onMounted(async () => {
  await loadSymbolInfo();
  await nextTick();
  measureContainer();
  resetView();
  if (chartContainer.value) {
    resizeObserver = new ResizeObserver(() => measureContainer());
    resizeObserver.observe(chartContainer.value);
  }
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("mousedown", onDocumentClickForPropSelect);
  connectBinanceWs();
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("mousedown", onDocumentClickForPropSelect);
  resizeObserver?.disconnect();
  closeBinanceWs();
});

watch(primaryCandles, () => {
  if (viewStartIndex.value === 0 || viewStartIndex.value > primaryCandles.value.length) {
    resetView();
  }
});
</script>

<style scoped>
.cev2-root {
  display: flex;
  flex-direction: column;
  height: 90vh;
  width: 100%;
  background: #0a0d12;
  color: #d7dde3;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", "SF Mono", Consolas, monospace;
  --bull: #26a69a;
  --bear: #ef5350;
  --accent: #4fc3f7;
}


.preview-top-btn {
  border: 1px solid rgba(255,255,255,.12);
  background: transparent;
  color: #8b95a1;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
}
.preview-top-btn:hover { color: #fff; border-color: rgba(255,255,255,.28); }
.preview-top-btn.buy.active, .preview-top-btn.buy:hover { color: var(--bull); border-color: var(--bull); background: rgba(38,166,154,.12); }
.preview-top-btn.sell.active, .preview-top-btn.sell:hover { color: var(--bear); border-color: var(--bear); background: rgba(239,83,80,.12); }
.preview-top-btn.place { color: var(--accent); border-color: rgba(79,195,247,.4); }
.preview-top-btn.place:hover:not(:disabled) { background: rgba(79,195,247,.12); }
.preview-top-btn:disabled { opacity: .45; cursor: not-allowed; }

.frvp-range-box { fill: rgba(79,195,247,.025); stroke: rgba(79,195,247,.22); stroke-width: 1; pointer-events: none; }
.frvp-range-box.selected { stroke: var(--accent); stroke-dasharray: 4 3; }
.frvp-buy { fill: var(--bull); opacity: .58; }
.frvp-sell { fill: var(--bear); opacity: .58; }
.avwap-group .avwap-line.selected { stroke-width: 2.3; }
.avwap-anchor-handle { stroke: transparent; stroke-width: 12; cursor: ew-resize; pointer-events: stroke; }
.avwap-anchor-handle-visible { fill: #b388ff; stroke: #fff; stroke-width: 1; cursor: ew-resize; }
.drawing-edge-handle { stroke: transparent; stroke-width: 10; pointer-events: stroke; cursor: ew-resize; }
.drawing-group .drawing-edge-handle:nth-of-type(n+3) { cursor: ns-resize; }
.drawing-group { pointer-events: visiblePainted; }
.drawing-handle { fill: #fff; stroke: #111; stroke-width: 1; cursor: move; }
.drawing-hit-line { stroke: transparent; stroke-width: 10; pointer-events: stroke; cursor: move; }
.drawing-move-hit { fill: transparent; stroke: none; cursor: move; pointer-events: all; }
.drawn-rect.selected, .price-range-box.selected { stroke-width: 2; stroke-dasharray: 4 3; }
.drawing-remove { fill: #ef5350; font-family: var(--mono); font-size: 12px; font-weight: 800; cursor: pointer; pointer-events: all; }
.drawing-remove:hover { fill: #fff; }
.heatmap-range-outline { fill: none; stroke: rgba(255,255,255,.25); stroke-width: 1; pointer-events: none; }
.heatmap-range-outline.selected { stroke: #ff8a65; stroke-width: 2; stroke-dasharray: 4 3; }
.preview-tp-line { stroke: var(--bull); stroke-width: 1; stroke-dasharray: 4 3; opacity: .85; pointer-events: none; }
.preview-sl-line { stroke: var(--bear); stroke-width: 1; stroke-dasharray: 4 3; opacity: .85; pointer-events: none; }
.preview-hit-line { stroke: transparent; stroke-width: 12; cursor: ns-resize; pointer-events: stroke; }
.drawing-toolbar {
  position: absolute; top: 44px; left: 6px; z-index: 20;
  display: flex; align-items: center; gap: 6px; padding: 5px 7px;
  background: rgba(10,13,18,.92); border: 1px solid rgba(255,255,255,.12);
  border-radius: 6px; font-family: var(--mono); font-size: 10px;
}
.drawing-toolbar span { color: var(--accent); font-weight: 700; }
.drawing-toolbar button {
  border: 1px solid rgba(255,255,255,.12); background: transparent; color: #9aa4b2;
  border-radius: 4px; padding: 3px 6px; cursor: pointer; font-family: var(--mono); font-size: 10px;
}
.drawing-toolbar button:hover { color: #fff; border-color: rgba(255,255,255,.3); }
.preview-order-btn {
  width: 100%; margin-top: 7px; padding: 5px 7px; border-radius: 5px;
  border: 1px solid rgba(79,195,247,.45); background: rgba(79,195,247,.1);
  color: var(--accent); font-family: var(--mono); font-weight: 700; cursor: pointer;
}
.preview-order-btn:hover:not(:disabled) { background: rgba(79,195,247,.18); }
.preview-order-btn:disabled { opacity: .45; cursor: not-allowed; }
.preview-error {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  z-index: 30; color: var(--bear); background: rgba(10,13,18,.92);
  border: 1px solid rgba(239,83,80,.35); padding: 5px 8px; border-radius: 5px;
  font: 10px var(--mono);
}
/* ── Top bar ── */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-wrap: wrap;
}
.topbar-group { display: flex; align-items: center; gap: 6px; }
.topbar-group-right { margin-left: auto; }

.symbol-badge {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.3px;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(79, 195, 247, 0.12);
  color: var(--accent);
}

.tf-tabs { display: flex; background: rgba(255, 255, 255, 0.04); border-radius: 6px; padding: 2px; }
.tf-tab {
  border: none; background: transparent; color: #8b95a1; font-family: var(--mono);
  font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 5px; cursor: pointer;
}
.tf-tab.active { background: var(--accent); color: #05131a; }

.chip {
  border: 1px solid rgba(255, 255, 255, 0.1); background: transparent; color: #8b95a1;
  font-family: var(--mono); font-size: 11px; font-weight: 600; padding: 4px 9px;
  border-radius: 5px; cursor: pointer;
}
.chip.active { background: rgba(38, 166, 154, 0.18); border-color: var(--bull); color: var(--bull); }
.chip.disabled { opacity: 0.35; cursor: not-allowed; }

.prop-select { position: relative; }
.prop-select-btn { min-width: 78px; }
.prop-select-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; width: 200px;
  background: #10141b; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); padding: 6px; display: flex; flex-direction: column; gap: 6px;
width: 30rem;
}
.prop-select-search {
  width: 100%; box-sizing: border-box; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);
  color: #d7dde3; font-family: var(--mono); font-size: 11px; border-radius: 4px; padding: 5px 7px;
}
.prop-select-list { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.prop-select-item {
  text-align: left; background: transparent; border: none; color: #8b95a1; font-family: var(--mono);
  font-size: 11px; padding: 5px 7px; border-radius: 4px; cursor: pointer;
}
.prop-select-item:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
.prop-select-item.active { background: rgba(79, 195, 247, 0.15); color: var(--accent); }
.prop-select-empty { color: #556; font-size: 11px; padding: 5px 7px; font-family: var(--mono); }

.bars-control { display: flex; align-items: center; gap: 4px; }
.bars-control-label { font-size: 10px; color: #667; text-transform: uppercase; letter-spacing: 0.4px; }
.bars-select, .bars-input {
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); color: #d7dde3;
  font-family: var(--mono); font-size: 11px; border-radius: 4px; padding: 3px 4px;
}
.bars-input { width: 56px; }

.icon-btn {
  border: 1px solid rgba(255, 255, 255, 0.1); background: transparent; color: #8b95a1;
  width: 26px; height: 26px; border-radius: 5px; cursor: pointer; font-size: 13px;
}
.icon-btn:hover { color: #fff; border-color: rgba(255, 255, 255, 0.3); }

/* ── Body / rail / chart ── */
.body-row { display: flex; flex: 1; min-height: 0; }

.tool-rail {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 6px; background: rgba(255, 255, 255, 0.015); border-right: 1px solid rgba(255, 255, 255, 0.06);
}
.rail-btn {
  width: 30px; height: 30px; border-radius: 6px; border: 1px solid transparent;
  background: transparent; color: #8b95a1; font-size: 14px; cursor: pointer;
}
.rail-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
.rail-btn.active { background: rgba(79, 195, 247, 0.15); border-color: var(--accent); color: var(--accent); }
.rail-sep { width: 18px; height: 1px; background: rgba(255, 255, 255, 0.1); margin: 4px 0; }

.chart-container { position: relative; flex: 1; min-width: 0; cursor: grab; user-select: none; }
.chart-container:active { cursor: grabbing; }
.chart-container.tool-rectangle, .chart-container.tool-line, .chart-container.tool-horizontal-line,
.chart-container.tool-price-range, .chart-container.tool-frvp, .chart-container.tool-liquidity { cursor: crosshair; }
.chart-container.tool-avwap { cursor: copy; }

.chart-status {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #667; font-size: 13px; font-family: var(--mono);
}
.chart-status-error { color: var(--bear); }

.chart-svg { display: block; }

/* candles */
.candle { cursor: pointer; }
.wick { stroke-width: 1; }
.candle.bull .wick { stroke: var(--bull); }
.candle.bear .wick { stroke: var(--bear); }
.body { stroke-width: 1; }
.candle.bull .body { fill: var(--bull); stroke: var(--bull); }
.candle.bear .body { fill: var(--bear); stroke: var(--bear); }
.candle:hover .body { opacity: 0.8; }

.anchor-dot { pointer-events: none; }
.anchor-avwap { fill: #b388ff; }
.anchor-frvp { fill: #ffd54f; }
.anchor-liq { fill: #ff8a65; }

/* grid / axes */
.grid-line { stroke: rgba(255, 255, 255, 0.045); }
.price-label { fill: #6b7480; font-size: 10px; font-family: var(--mono); }
.hover-price-label { fill: #0a0d12; }
.time-label { fill: #6b7480; font-size: 10px; font-family: var(--mono); text-anchor: middle; }
.crosshair-line { stroke: rgba(255, 255, 255, 0.25); stroke-dasharray: 3 3; }

/* overlay ghost candles */
.overlay-body { opacity: 0.32; }
.overlay-body.bull { fill: var(--bull); stroke: var(--bull); }
.overlay-body.bear { fill: var(--bear); stroke: var(--bear); }
.overlay-wick { opacity: 0.32; stroke-width: 1; }
.overlay-wick.bull { stroke: var(--bull); }
.overlay-wick.bear { stroke: var(--bear); }

/* current price line */
.live-price-line { stroke-width: 1; stroke-dasharray: 6 4; pointer-events: none; }
.live-price-line.bull { stroke: var(--bull); }
.live-price-line.bear { stroke: var(--bear); }
.live-price-label { font-family: var(--mono); font-size: 10px; font-weight: 700; pointer-events: none; }
.live-price-label.bull { fill: var(--bull); }
.live-price-label.bear { fill: var(--bear); }

/* cross-tf ema */
.xtf-ema-line { fill: none; stroke-width: 1.4; opacity: 0.85; }
.xtf-ema-15m { stroke: #f48fb1; color: #f48fb1; }
.xtf-ema-1h { stroke: #ffb74d; color: #ffb74d; }
.xtf-ema-4h { stroke: #4fc3f7; color: #4fc3f7; }
.xtf-ema-1d { stroke: #ba68c8; color: #ba68c8; }
.xtf-ema-label { fill: currentColor; font-family: var(--mono); font-size: 9px; font-weight: 600; opacity: 0.9; pointer-events: none; }

/* drawings */
.drawn-rect { fill: rgba(79, 195, 247, 0.08); stroke: var(--accent); stroke-width: 1; }
.drawn-line { stroke: #eeeeee; stroke-width: 1.8; pointer-events: none; }
.drawing-hit-line { pointer-events: stroke; }
.drawn-horizontal-line { stroke: #ffd54f; stroke-width: 1.4; stroke-dasharray: 6 4; pointer-events: none; }
.drawing-hit-horizontal { stroke: transparent; stroke-width: 12; pointer-events: stroke; cursor: ns-resize; }
.drawn-line.selected, .drawn-horizontal-line.selected { stroke-width: 2.4; }
.draft-rect { fill: rgba(255, 255, 255, 0.06); stroke: #fff; stroke-dasharray: 4 3; stroke-width: 1; }
.draft-line { stroke: #fff; stroke-dasharray: 4 3; stroke-width: 1.2; }

.price-range-box { fill: rgba(255, 255, 255, 0.05); stroke-width: 1; }
.price-range-box.up { stroke: var(--bull); }
.price-range-box:not(.up) { stroke: var(--bear); }
.price-range-label { fill: #d7dde3; font-family: var(--mono); font-size: 10px; text-anchor: middle; }

.frvp-row { opacity: .58; }
.frvp-poc { stroke: #ffd54f; stroke-width: 1; stroke-dasharray: 2 2; }

.avwap-line { fill: none; stroke: #b388ff; stroke-width: 1.4; }

.liquidity-heatmap rect { pointer-events: none; }

/* preview position */
.preview-zone { pointer-events: none; }
.preview-tp { fill: rgba(38, 166, 154, 0.18); }
.preview-sl { fill: rgba(239, 83, 80, 0.18); }
.preview-entry-line { stroke: #fff; stroke-width: 1; stroke-dasharray: 5 3; }

/* subplots */
.subplot-title { fill: #576172; font-size: 9px; font-family: var(--mono); letter-spacing: 0.6px; }
.prop-bar { fill: rgba(79, 195, 247, 0.55); }

/* HUD */
.hud {
  position: absolute; top: 6px; left: 6px; display: flex; align-items: center; gap: 10px;
  padding: 5px 10px; background: rgba(10, 13, 18, 0.72); border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px; font-family: var(--mono); font-size: 11px; backdrop-filter: blur(4px); pointer-events: none;
}
.hud-symbol { color: var(--accent); font-weight: 700; }
.hud-tf { color: #667; }
.hud-live-price { color: var(--accent); }
.hud-live-price b { margin-left: 3px; }
.hud-item { color: #8b95a1; }
.hud-item b { color: #d7dde3; font-weight: 600; margin-left: 3px; }
.hud-item.up { color: var(--bull); }
.hud-item.down { color: var(--bear); }

/* preview panel */
.preview-panel {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 170px; padding: 8px 10px;
  background: rgba(10, 13, 18, 0.88); border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px; font-family: var(--mono); font-size: 11px;
}
.preview-panel-title { display: flex; justify-content: space-between; align-items: center; font-weight: 700; margin-bottom: 6px; cursor: move; user-select: none; }
.preview-panel-close { background: none; border: none; color: #8b95a1; cursor: pointer; }
.preview-panel-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.preview-panel-row label { color: #667; }
.preview-panel-row input { width: 78px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #d7dde3; font-family: var(--mono); border-radius: 4px; padding: 2px 4px; }
.preview-panel-rr span { color: var(--accent); font-weight: 700; }

/* ── modals ── */
.modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: #10141b; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; max-width: 640px; max-height: 82vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); position: sticky; top: 0; background: #10141b; }
.modal-header h2 { margin: 0; font-size: 14px; font-family: var(--mono); color: var(--accent); font-weight: 600; }
.close-btn { background: none; border: none; color: #8b95a1; font-size: 18px; cursor: pointer; }
.close-btn:hover { color: #fff; }
.modal-body { padding: 16px 18px; }

.detail-grid { display: flex; flex-direction: column; gap: 16px; }
.detail-section { border-left: 2px solid var(--bull); padding-left: 12px; }
.detail-section h3 { margin: 0 0 8px; font-size: 11px; color: var(--bull); text-transform: uppercase; letter-spacing: 0.5px; }
.detail-item { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 12px; }
.detail-item label { color: #667; }
.detail-item span { font-family: var(--mono); color: #d7dde3; }
.nested-section { margin: 8px 0 8px 8px; padding-left: 10px; border-left: 1px solid rgba(255, 255, 255, 0.08); }
.nested-section h4 { margin: 0 0 4px; font-size: 10px; color: #667; text-transform: uppercase; letter-spacing: 0.5px; }
.detail-item.nested { margin-bottom: 3px; }
.dynamic-detail-section { min-width: 0; }
.dynamic-detail-section > h3 { margin-bottom: 8px; }
.detail-nested { margin-left: 8px; padding-left: 10px; border-left: 1px solid rgba(255, 255, 255, 0.08); }
.detail-complex-entry { margin-bottom: 8px; }
.detail-complex-entry > label { display: block; margin-bottom: 4px; color: #8b95a1; font-size: 11px; }
.detail-complex-entry > .detail-nested,
.detail-complex-entry > .detail-array { margin-left: 8px; }
.detail-array { display: flex; flex-direction: column; gap: 5px; }
.detail-array-object { padding: 6px 8px; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 4px; background: rgba(255, 255, 255, 0.02); }
.detail-array-index { color: #667; font-family: var(--mono); font-size: 10px; margin-right: 7px; }
.detail-array-value { display: flex; align-items: center; gap: 2px; }
.detail-number, .detail-text { font-family: var(--mono); color: #d7dde3; text-align: right; overflow-wrap: anywhere; }
.detail-null { color: #667; font-family: var(--mono); }
.detail-subsection { margin-bottom: 8px; }
.detail-subsection:last-child { margin-bottom: 0; }
.boolean-badge { padding: 1px 6px; border-radius: 4px; font: 700 10px var(--mono); }
.boolean-badge.is-true { background: rgba(38, 166, 154, 0.16); color: var(--bull); }
.boolean-badge.is-false { background: rgba(255, 255, 255, 0.06); color: #667; }
.candle-detail-modal { width: min(760px, calc(100vw - 32px)); }
.candle-detail-modal .modal-body { max-height: calc(82vh - 54px); overflow-y: auto; }

.side-badge, .status-badge { padding: 1px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.side-badge.side-bullish { background: rgba(38, 166, 154, 0.22); color: var(--bull); }
.side-badge.side-bearish { background: rgba(239, 83, 80, 0.22); color: var(--bear); }
.side-badge.side-neutral, .side-badge.side-range { background: rgba(255, 255, 255, 0.08); color: #8b95a1; }
.status-badge { background: rgba(79, 195, 247, 0.16); color: var(--accent); }

.hotkeys-modal .modal-body { display: flex; flex-direction: column; gap: 6px; }
.hotkey-row { display: flex; align-items: center; gap: 12px; font-size: 12px; }
.hotkey-row kbd { min-width: 42px; text-align: center; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 4px; padding: 2px 6px; font-family: var(--mono); font-size: 11px; color: var(--accent); }

.overlay-instance .chart-container { cursor: default; }

.confluence-marker {
    pointer-events: none;
}

.confluence-chevron {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.confluence-long .confluence-chevron {
    stroke: #22c55e;
}

.confluence-short .confluence-chevron {
    stroke: #ef4444;
}

.confluence-confidence {
    font-size: 9px;
    font-weight: 600;
    pointer-events: none;
}

.confluence-long .confluence-confidence {
    fill: #22c55e;
}

.confluence-short .confluence-confidence {
    fill: #ef4444;
}
</style>