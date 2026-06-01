<template>
  <div class="app-shell">
    <aside class="side-nav">
      <div class="brand">
        <div class="brand-title">TD Manage</div>
        <div class="brand-subtitle">本地 TDengine 数据操作台</div>
      </div>
      <router-link class="nav-link" to="/">仪表盘</router-link>
      <router-link class="nav-link" to="/connections">连接管理</router-link>
      <router-link class="nav-link" to="/data">数据浏览</router-link>
      <router-link class="nav-link" to="/sql">SQL 控制台</router-link>
      <router-link v-if="auth.hasPermission('system:user:manage')" class="nav-link" to="/users">账号管理</router-link>
      <router-link class="nav-link" to="/audit">审计日志</router-link>
    </aside>
    <main class="main-area">
      <header class="topbar">
        <div>
          <h1 class="page-title">TDengine 安全数据工作台</h1>
          <p class="page-desc">所有写操作都先预览 SQL，再进行强确认。</p>
        </div>
        <el-dropdown>
          <el-button>
            {{ auth.user?.displayName || auth.user?.username }}
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="openAccount">账号设置</el-dropdown-item>
              <el-dropdown-item @click="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>
      <section class="content-scroll">
        <router-view />
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

function openAccount() {
  router.push("/account");
}

function logout() {
  auth.logout();
  router.push("/login");
}
</script>
