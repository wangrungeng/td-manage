import axios from "axios";
import { ElMessage } from "element-plus";

const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30000
});

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem("td-manage-token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = [error.response?.data?.message, error.response?.data?.detail].filter(Boolean).join("：") || error.message || "请求失败";
    ElMessage.error(message);
    return Promise.reject(error.response?.data ?? error);
  }
);

export const http = {
  get: <T>(url: string, config?: Parameters<typeof axiosInstance.get>[1]) => axiosInstance.get<T, T>(url, config),
  post: <T>(url: string, data?: unknown, config?: Parameters<typeof axiosInstance.post>[2]) =>
    axiosInstance.post<T, T>(url, data, config),
  patch: <T>(url: string, data?: unknown, config?: Parameters<typeof axiosInstance.patch>[2]) =>
    axiosInstance.patch<T, T>(url, data, config),
  delete: <T>(url: string, config?: Parameters<typeof axiosInstance.delete>[1]) => axiosInstance.delete<T, T>(url, config)
};
