<template>
  <div v-if="isVisible" class="modal-backdrop">
    <div class="modal-content">
      <h2 class="modal-title">{{ fieldLabel }}</h2>
      
      <!-- Calendar -->
      <div class="calendar">
        <div class="calendar-header">
          <button @click="prevMonth"><i class="fas fa-chevron-left"></i></button>
          
          <!-- Month selector -->
          <select v-model="currentMonth">
            <option v-for="(m, i) in months" :key="m" :value="i">
              {{ m }}
            </option>
          </select>

          <!-- Year selector -->
          <select v-model="currentYear">
            <option
              v-for="year in yearRange"
              :key="year"
              :value="year"
            >
              {{ year }}
            </option>
          </select>

          <button @click="nextMonth"><i class="fas fa-chevron-right"></i></button>
        </div>

        <div class="calendar-grid">
          <div class="day" v-for="d in days" :key="d">{{ d }}</div>
          <div
            v-for="blank in blankDays"
            :key="'blank-' + blank"
            class="day empty"
          ></div>
          <div
            v-for="day in daysInMonth"
            :key="day"
            class="day"
            :class="{ selected: day === selectedDay }"
            @click="selectDate(day)"
          >
            {{ day }}
          </div>
        </div>

        <!-- Time Picker -->
        <div class="time-picker">
          <label class="time-label">Time:</label>
          <div class="time-controls">
            
            <!-- Hour -->
            <div class="time-box">
              <button @click="incrementHour" class="color-secondary">▲</button>
              <input
                type="number"
                v-model.number="displayHourInput"
                @blur="normalizeHour"
                min="1"
                max="12"
              />
              <button @click="decrementHour" class="color-secondary">▼</button>
            </div>

            <span class="colon">:</span>

            <!-- Minute -->
            <div class="time-box">
              <button @click="incrementMinute" class="color-secondary">▲</button>
              <input
                type="number"
                v-model.number="minute"
                @blur="normalizeMinute"
                min="0"
                max="59"
              />
              <button @click="decrementMinute" class="color-secondary">▼</button>
            </div>

            <!-- AM/PM toggle -->
            <div class="ampm-toggle">
              <button
                :class="{ active: isAM }"
                @click="setAMPM('AM')"
              >AM</button>
              <button
                :class="{ active: !isAM }"
                @click="setAMPM('PM')"
              >PM</button>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="actions">
          <button @click="cancel">Cancel</button>
          <button @click="clear" class="clear-btn">Clear</button>
          <button class="confirm-btn" @click="confirm">Set</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = defineProps<{
  modelValue: Date | null;
  fieldLabel: string;
  visible: boolean;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: Date | null): void;
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const isVisible = computed(() => props.visible);

const now = props.modelValue ? new Date(props.modelValue) : new Date();

const currentMonth = ref(now.getMonth());
const currentYear = ref(now.getFullYear());
const selectedDay = ref(now.getDate());
const rawHour = ref(now.getHours()); // store in 24h
const minute = ref(now.getMinutes());
const isAM = ref(rawHour.value < 12);

const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const months = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// Year range: 50 years back and forward
const yearRange = computed(() => {
  const start = now.getFullYear() - 50;
  const end = now.getFullYear() + 50;
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
});

const daysInMonth = computed(() => {
  return new Date(currentYear.value, currentMonth.value + 1, 0).getDate();
});

const blankDays = computed(() => {
  const firstDay = new Date(currentYear.value, currentMonth.value, 1).getDay();
  return Array.from({ length: firstDay }, (_, i) => i);
});

// editable hour in 12h format
const displayHour = computed(() => {
  let h = rawHour.value % 12;
  return h === 0 ? 12 : h;
});
const displayHourInput = ref(displayHour.value);

watch(displayHour, (val) => {
  displayHourInput.value = val;
});

// ---- Time Functions ----
const normalizeHour = () => {
  let val = displayHourInput.value;
  if (!val || val < 1) val = 1;
  if (val > 12) val = 12;
  displayHourInput.value = val;
  rawHour.value = isAM.value ? (val % 12) : (val % 12) + 12;
};

const normalizeMinute = () => {
  if (minute.value < 0) minute.value = 0;
  if (minute.value > 59) minute.value = 59;
};

const setAMPM = (val: 'AM' | 'PM') => {
  isAM.value = val === 'AM';
  normalizeHour();
};

const incrementHour = () => {
  rawHour.value = (rawHour.value + 1) % 24;
  isAM.value = rawHour.value < 12;
};
const decrementHour = () => {
  rawHour.value = (rawHour.value + 23) % 24;
  isAM.value = rawHour.value < 12;
};
const incrementMinute = () => {
  minute.value = (minute.value + 1) % 60;
};
const decrementMinute = () => {
  minute.value = (minute.value + 59) % 60;
};

// ---- Confirm/Cancel ----
const confirm = () => {
  let finalHour = displayHourInput.value % 12;
  if (!isAM.value) finalHour += 12;

  const newDate = new Date(
    currentYear.value,
    currentMonth.value,
    selectedDay.value,
    finalHour,
    minute.value
  );
  emit('update:modelValue', newDate);
  emit('changed');
  emit('close');
};

const clear = () => {
  emit('update:modelValue', null);
  emit('changed');
  emit('close');
};

const cancel = () => {
  emit('close');
};

const selectDate = (day: number) => {
  selectedDay.value = day;
};

const prevMonth = () => {
  if (currentMonth.value === 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else {
    currentMonth.value--;
  }
};
const nextMonth = () => {
  if (currentMonth.value === 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else {
    currentMonth.value++;
  }
};
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  z-index: 1000;
}
.modal-content {
  background: white;
  padding: 1.5rem;
  border-radius: 12px;
  width: 400px;
  max-width: 95%;
}
.modal-title {
  font-size: 1.25rem;
  margin-bottom: 1rem;
}
.calendar-header {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}
.calendar-header select {
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.25rem;
  margin-top: 0.5rem;
}
.day {
  text-align: center;
  padding: 0.5rem 0;
  cursor: pointer;
}
.day.selected {
  background-color: #007bff;
  color: white;
  border-radius: 35%;
}
.day.empty {
  visibility: hidden;
}
.time-picker {
  margin-top: 1rem;
  text-align: center;
}
.time-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}
.time-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}
.time-box {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.time-box input {
  width: 4.5rem;
  text-align: center;
  font-size: 1.8rem;
  font-weight: bold;
  margin: 0.25rem 0;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.time-box button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
}
.colon {
  font-size: 1.25rem;
  font-weight: bold;
}
.ampm-toggle {
  display: flex;
  border: 1px solid #ddd;
  border-radius: 6px;
  overflow: hidden;
}
.ampm-toggle button {
  padding: 0.25rem 0.75rem;
  border: none;
  background: #f9f9f9;
  cursor: pointer;
}
.ampm-toggle button.active {
  background: #007bff;
  color: white;
}
.actions {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
button {
  padding: 0.4rem 0.75rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
button:hover {
  background: #eee;
}
.confirm-btn {
  background: #007bff;
  color: white;
}
.confirm-btn:hover {
  background: #0066d1;
}

.clear-btn {
  background: #f44336;
  color: white;
}
.clear-btn:hover {
  background: #d32f2f;
}
</style>
