import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import AppLayout from "../layouts/AppLayout.vue";
import LoginView from "../views/LoginView.vue";
import InitView from "../views/InitView.vue";
import DashboardView from "../views/DashboardView.vue";
import ConnectionsView from "../views/ConnectionsView.vue";
import DataBrowserView from "../views/DataBrowserView.vue";
import SqlConsoleView from "../views/SqlConsoleView.vue";
import UsersView from "../views/UsersView.vue";
import AuditView from "../views/AuditView.vue";
import AccountView from "../views/AccountView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: LoginView },
    { path: "/init", component: InitView },
    {
      path: "/",
      component: AppLayout,
      children: [
        { path: "", component: DashboardView },
        { path: "connections", component: ConnectionsView },
        { path: "data", component: DataBrowserView },
        { path: "sql", component: SqlConsoleView },
        { path: "account", component: AccountView },
        { path: "users", component: UsersView },
        { path: "audit", component: AuditView }
      ]
    }
  ]
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  const initialized = await auth.loadStatus();
  if (!initialized && to.path !== "/init") return "/init";
  if (initialized && to.path === "/init") return "/login";
  if (to.path !== "/login" && !auth.user && auth.token) {
    try {
      await auth.loadMe();
    } catch {
      auth.logout();
    }
  }
  if (!["/login", "/init"].includes(to.path) && !auth.user) return "/login";
  if (to.path === "/login" && auth.user) return "/";
});
