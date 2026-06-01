<template>
  <div class="metric-grid">
    <div class="metric">
      连接策略
      <strong>本地</strong>
      <span>默认监听 127.0.0.1</span>
    </div>
    <div class="metric">
      写入模式
      <strong>预览</strong>
      <span>SQL 预览 + 二次确认</span>
    </div>
    <div class="metric">
      修改语义
      <strong>覆盖</strong>
      <span>同表同时间戳 INSERT</span>
    </div>
    <div class="metric">
      审计级别
      <strong>完整</strong>
      <span>记录 SQL、用户和结果</span>
    </div>
  </div>
  <el-alert style="margin-top: 20px" title="安全提示" type="warning" show-icon :closable="false">
    删除和写 SQL 属于高风险操作。工具只做确认和审计，不会让 TDengine 删除数据可恢复。
  </el-alert>
</template>
