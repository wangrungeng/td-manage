<template>
  <div class="auth-shell">
    <section class="auth-hero">
      <h1>Precise control for TDengine rows.</h1>
      <p>把删除、修改、新增这些高风险操作收进一个本地安全工作台：先预览 SQL，再确认执行，全程审计。</p>
    </section>
    <section class="auth-panel">
      <el-form class="auth-card" :model="form" label-position="top" @submit.prevent="submit">
        <h2>登录 TD Manage</h2>
        <el-form-item label="用户名">
          <el-input v-model="form.username" autofocus />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" size="large" :loading="loading" style="width: 100%" @click="submit">进入工作台</el-button>
      </el-form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const form = reactive({ username: "", password: "" });

async function submit() {
  loading.value = true;
  try {
    await auth.login(form);
    router.push("/");
  } finally {
    loading.value = false;
  }
}
</script>
