<template>
  <CardComponent>
    <CardBodyComponent>
      <div class="text-center">
        <h2>Choco Minto!</h2>
        <div class="time-display">{{ timeRemainingDisplay }}</div>
      </div>
    </CardBodyComponent>
  </CardComponent>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, onUnmounted } from "vue";
import CardBodyComponent from "../shared/card/CardBodyComponent.vue";
import CardComponent from "../shared/card/CardComponent.vue";
import type { Candle } from "@/core/interfaces";

const props = defineProps<{
  symbol: string;
  interval: string;
}>();

const emits = defineEmits([
  "on-socket-close",
  "on-socket-open",
  "on-socket-error",
  "on-new-candle"
]);

const wsCandle = ref<WebSocket | null>(null);
const candles = ref<Candle[]>([]);
const timeRemainingInCandle = ref(60);

const timeRemainingDisplay = computed(() => {
  const mins = Math.floor(timeRemainingInCandle.value / 60);
  const secs = timeRemainingInCandle.value % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
});

let reconnectTimeout: ReturnType<typeof setTimeout>;

function updateTimeRemaining() {
  if (!candles.value[candles.value.length - 1]) return;
  const now = Date.now();
  const timeLeft = (candles.value[candles.value.length - 1].closeTime - now) / 1000;
  timeRemainingInCandle.value = Math.max(Math.round(timeLeft), 0);
}

function createCandleSocket() {
  try {
    wsCandle.value = new WebSocket(
      `wss://fstream.binance.com/ws/${props.symbol.toLowerCase()}@kline_${props.interval}`
    );

    let initialized = false;

    wsCandle.value.onopen = () => {
      emits("on-socket-open");
      console.log("WebSocket connected");
    };

    wsCandle.value.onclose = () => {
      emits("on-socket-close");
      console.warn("WebSocket closed, reconnecting in 2s...");
      reconnectTimeout = setTimeout(createCandleSocket, 2000);
    };

    wsCandle.value.onerror = (err) => {
      emits("on-socket-error");
      console.error("WebSocket error:", err);
      wsCandle.value?.close();
    };

    wsCandle.value.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const k = msg.k;
      const lastCandle = candles.value[candles.value.length - 1];

      if (!lastCandle || lastCandle.openTime !== k.t) {
        if (lastCandle) lastCandle.closed = true;

        const newCandle: Candle = {
          openTime: k.t,
          open: +k.o,
          high: +k.h,
          low: +k.l,
          close: +k.c,
          volume: +k.v,
          closeTime: k.T,
          closed: k.x,
          support: null,
          resistance: null,
          breakthrough_resistance: false,
          breakthrough_support: false,
        };

        candles.value.push(newCandle);
        if (candles.value.length > 3) candles.value.shift();

        if (initialized) emits("on-new-candle", newCandle);
        initialized = true;
      } else {
        lastCandle.high = Math.max(lastCandle.high, +k.h);
        lastCandle.low = Math.min(lastCandle.low, +k.l);
        lastCandle.close = +k.c;
        lastCandle.volume = +k.v;
        lastCandle.closed = k.x;
      }
    };
  } catch (error) {
    console.error("Candle socket setup error:", error);
    reconnectTimeout = setTimeout(createCandleSocket, 2000);
  }
}

onMounted(() => {
  createCandleSocket();
  setInterval(updateTimeRemaining, 1000);
});

onUnmounted(() => {
  wsCandle.value?.close();
  clearTimeout(reconnectTimeout);
});
</script>

