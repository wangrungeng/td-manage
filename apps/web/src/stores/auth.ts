import { defineStore } from "pinia";
import { http } from "../api/http";

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: localStorage.getItem("td-manage-token") || "",
    user: null as CurrentUser | null,
    initialized: true
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.token && state.user),
    hasPermission: (state) => (permission: string) => state.user?.permissions.includes(permission) ?? false
  },
  actions: {
    async loadStatus() {
      const result = await http.get<{ initialized: boolean }>("/auth/status");
      this.initialized = result.initialized;
      return result.initialized;
    },
    async initAdmin(payload: { username: string; displayName: string; password: string }) {
      await http.post("/auth/init", payload);
      this.initialized = true;
    },
    async login(payload: { username: string; password: string }) {
      const result = await http.post<{ token: string }>("/auth/login", payload);
      this.token = result.token;
      localStorage.setItem("td-manage-token", result.token);
      await this.loadMe();
    },
    async loadMe() {
      if (!this.token) return;
      const result = await http.get<{ user: CurrentUser }>("/auth/me");
      this.user = result.user;
    },
    async updateMe(payload: { displayName: string }) {
      const result = await http.patch<{ user: CurrentUser }>("/auth/me", payload);
      this.user = result.user;
    },
    async changePassword(payload: { oldPassword: string; newPassword: string }) {
      await http.post("/auth/me/change-password", payload);
    },
    logout() {
      this.token = "";
      this.user = null;
      localStorage.removeItem("td-manage-token");
    }
  }
});
