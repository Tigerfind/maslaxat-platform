// PM2 Configuration for eMaslaxat
// Socket.io requires fork mode (not cluster) unless using socket.io-redis adapter
module.exports = {
  apps: [
    {
      name: 'emaslaxat-api',
      script: './backend/api/src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_memory_restart: '512M',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'emaslaxat-frontend',
      script: 'npx',
      args: 'serve -s ./frontend/build -l 3000',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '256M',
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
    },
  ],
};
