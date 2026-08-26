/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { setDefaultResultOrder } from 'node:dns';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

// Một số nền tảng (Render...) KHÔNG định tuyến ra ngoài bằng IPv6 -> Node phân giải smtp.gmail.com
// ra địa chỉ IPv6 rồi kết nối thất bại (ENETUNREACH / Connection timeout) khiến gửi email tịt.
// Ép phân giải DNS ưu tiên IPv4 để SMTP (và mọi kết nối ra ngoài) đi qua IPv4.
setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS: domain frontend được phép gọi API. Dev mặc định localhost:4200; production đặt
  // biến môi trường CORS_ORIGIN = URL frontend thật (nhiều domain thì ngăn cách bằng dấu phẩy),
  // vd: CORS_ORIGIN=https://lich-cua-ban.vercel.app
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 3000;
  // '0.0.0.0' = lắng nghe trên MỌI card mạng -> máy khác trong cùng WiFi/LAN truy cập được
  // qua http://<IP-máy-này>:3000, không chỉ localhost.
  await app.listen(port, '0.0.0.0');
  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
  Logger.log(`🌐 Trên mạng LAN: http://<IP-máy-của-bạn>:${port}/${globalPrefix}`);
}

bootstrap();