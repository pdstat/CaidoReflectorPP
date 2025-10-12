<script setup lang="ts">
import Card from "primevue/card"
import Textarea from "primevue/textarea"
import Button from "primevue/button"
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
    <Card class="p-6 bg-surface-0 dark:bg-surface-900 shadow rounded-xl">
        <template #title>
            <i id="the-bomb" class="fas fa-cog"></i> Settings
        </template>
        <template #content>
            <div class="p-4">
                <div class="flex flex-col items-start">
                    <label class="text-lg block mb-2">Content Types<br>
                        <span class="text-sm text-muted">Content-Type mime response headers that will be checked for
                            reflected values *</span>
                    </label>
                    <Textarea autoResize rows="15" class="w-full" spellcheck="false" />
                    <div class="flex justify-start">
                        <Button label="Save Content Types" icon="fas fa-save" class="p-button-primary" />
                    </div>
                    <div class="flex justify-end">
                        <Button label="Reset Content Types" icon="fas fa-save" class="p-button-secondary" />
                    </div>
                    <label class="flex items-center space-x-2">
                        <Checkbox v-model="probeOutOfScope" :binary="true" :disabled="!loaded" />
                        <span class="text-sm text-white">Probe out of scope requests</span>
                    </label>
                </div>
            </div>
        </template>
    </Card>
</template>