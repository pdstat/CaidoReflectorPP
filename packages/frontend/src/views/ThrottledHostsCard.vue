<script setup lang="ts">
import Card from "primevue/card"
import Button from "primevue/button"
import DataTable from "primevue/datatable"
import Column from "primevue/column"
import { ref, onMounted, onUnmounted } from "vue"
import { Reflector } from "@/types"

type ThrottledHost = Awaited<ReturnType<typeof Reflector.sdk.backend.getThrottledHosts>>[number]

const REFRESH_MS = 5000

const hosts = ref<ThrottledHost[]>([])
const error = ref("")
let timer: ReturnType<typeof setInterval> | undefined

const refresh = async () => {
    try {
        hosts.value = await Reflector.sdk.backend.getThrottledHosts()
        error.value = ""
    } catch (e) {
        error.value = `Could not load throttled hosts: ${e}`
    }
}

const reset = async (host: string) => {
    try {
        await Reflector.sdk.backend.resetThrottledHost(host)
    } catch (e) {
        error.value = `Could not reset ${host}: ${e}`
    }
    await refresh()
}

const remaining = (ms: number) => {
    const s = Math.ceil(ms / 1000)
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

onMounted(() => {
    refresh()
    timer = setInterval(refresh, REFRESH_MS)
})

onUnmounted(() => {
    if (timer !== undefined) clearInterval(timer)
})
</script>

<template>
    <Card class="p-6 bg-surface-0 dark:bg-surface-900 shadow rounded-xl">
        <template #title>
            <i class="fas fa-gauge-high"></i> Throttled hosts
        </template>
        <template #subtitle>
            Domains that answered 429 (or 503 with Retry-After) are paused; repeated blocks open
            a circuit breaker and stop probing them for 15 minutes. Scans interrupted by a block
            are dropped, and their parameters are retested on the next request.
        </template>

        <template #content>
            <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
            <p v-if="hosts.length === 0" class="text-sm text-muted">No domains are throttled.</p>
            <DataTable v-else :value="hosts" dataKey="host" size="small">
                <Column field="host" header="Domain" />
                <Column header="State">
                    <template #body="{ data }">
                        {{ data.state === "circuit-open" ? "Circuit open" : "Cooling down" }}
                    </template>
                </Column>
                <Column header="Time left">
                    <template #body="{ data }">{{ remaining(data.remainingMs) }}</template>
                </Column>
                <Column field="recentBlocks" header="Blocks (2 min)" />
                <Column field="queued" header="Queued" />
                <Column header="">
                    <template #body="{ data }">
                        <Button label="Reset" icon="fas fa-rotate-left" severity="secondary" size="small"
                            @click="reset(data.host)" />
                    </template>
                </Column>
            </DataTable>
        </template>
    </Card>
</template>
