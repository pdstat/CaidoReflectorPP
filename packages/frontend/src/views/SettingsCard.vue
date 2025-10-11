<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import Checkbox from 'primevue/checkbox'
import { Reflector } from "@/types"

const probeOutOfScope = ref(false);
const loaded = ref(false);

const settings = Reflector.settings;

onMounted(async () => {
  probeOutOfScope.value = settings.getProbeOutOfScope() === true
  loaded.value = true
})

// Watch for changes and persist to storage
watch(probeOutOfScope, async (newVal) => {
  if (loaded.value) {
    await settings.setProbeOutOfScope(newVal);
  }
})
</script>

<template>
  <div class="p-4">
    <div class="flex flex-col items-start">
      <label class="flex items-center space-x-2">
        <Checkbox v-model="probeOutOfScope" :binary="true" :disabled="!loaded" />
        <span class="text-sm text-white">Probe out of scope requests</span>
      </label>
    </div>
  </div>
</template>