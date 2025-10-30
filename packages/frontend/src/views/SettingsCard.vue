<script setup lang="ts">
import Card from "primevue/card"
import Textarea from "primevue/textarea"
import Button from "primevue/button"
import ToggleSwitch from 'primevue/toggleswitch';
import { ref, onMounted, watch } from "vue"
import { Reflector } from "@/types"

const probeOutOfScope = ref(false)
const noSniffContentTypes = ref<string>("")
const loaded = ref(false)
const settings = Reflector.settings

const allowedRegex = /^[!#$%&'*+\-\.^_`|~0-9A-Za-z/;=," ]+$/

const validateBeforeInput = (event: InputEvent) => {
  const char = event.data
  // If the input data (character) exists and doesn't match the regex, block it
  if (char && !allowedRegex.test(char)) {
    event.preventDefault() // Prevent invalid input from being applied
  }
}

const saveContentTypes = async () => {
    if (loaded.value) {
        const typesSet = new Set<string>(
            noSniffContentTypes.value.split("\n")
                .map(s => s.trim())
                .filter(s => s.length > 0)
        )
        await settings.setNoSniffContentTypes(typesSet)
    }
}

const resetContentTypes = async () => {
    const defaultContentTypes = settings.getDefaultNoSniffContentTypes()
    noSniffContentTypes.value = Array.from(defaultContentTypes).sort().join("\n")
    if (loaded.value) {
        await settings.setNoSniffContentTypes(defaultContentTypes)
    }
}

onMounted(async () => {
    probeOutOfScope.value = settings.getProbeOutOfScope() === true
    noSniffContentTypes.value = Array.from(settings.getNoSniffContentTypes()).sort().join("\n")
    loaded.value = true
})

watch(probeOutOfScope, async (v) => {
    if (loaded.value) {
        await settings.setProbeOutOfScope(v)
    }
})

</script>

<template>
    <Card class="p-6 bg-surface-0 dark:bg-surface-900 shadow rounded-xl">
        <template #title>
            <i class="fas fa-cog"></i> Settings
        </template>

        <template #content>
            <div class="space-y-6">
                <div class="flex space-x-6">
                <!--Content type settings-->
                <div class="w-1/2 space-y-3">
                        <label class="text-lg block mb-2">
                            Content Types<br />
                            <span class="text-sm text-muted">
                                Content-Type mime response headers that will be checked for reflected values *
                            </span>
                        </label>

                        <Textarea v-model="noSniffContentTypes" autoResize rows="15" class="w-full mb-4"
                            spellcheck="false" @beforeinput="validateBeforeInput" />

                        <div class="button-row" role="group">
                            <Button label="Save Content Types" icon="fas fa-save" class="p-button-primary" @click="saveContentTypes" />
                            <Button label="Reset Content Types" icon="fas fa-rotate-left" severity="secondary" @click="resetContentTypes" />
                        </div>
                </div>
                <!--Toggle switches-->
                <div class="w-1/2 space-y-3">
                        <label>
                            <ToggleSwitch v-model="probeOutOfScope" :disabled="!loaded" />
                            <span class="text-sm">Probe out of scope requests</span>
                        </label>
                </div>
                </div>
            </div>
        </template>
    </Card>
</template>

<style scoped>
.settings-grid {
    display: grid;
    grid-template-columns: 1fr;
    /* stack on small screens */
    gap: 1.5rem;
}

@media (min-width: 768px) {

    /* 50/50 from md+ */
    .settings-grid {
        grid-template-columns: 1fr 1fr;
    }
}

.button-row {
    display: inline-flex;
    gap: 1rem;
    margin-top: .5rem;
}

.checkbox-row {
    display: inline-flex;
    align-items: center;
    gap: .75rem;
}
</style>
