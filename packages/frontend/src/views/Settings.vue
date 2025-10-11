<script setup lang="ts">
import MenuBar from 'primevue/menubar'
import { computed } from 'vue'
import SettingsCard from "@/views/SettingsCard.vue";

const menuItems = computed(() => [
  {
    label: "Reflector++",
    icon: "fas fa-biohazard",
    disabled: true,
    class: "titleTab"
  }
]);
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden pl-6 pr-6 pt-6 space-y-6">

    <MenuBar :model="menuItems"/>
      <div class="space-y-6 h-full">
        <SettingsCard/>
      </div>
  </div>
</template>
