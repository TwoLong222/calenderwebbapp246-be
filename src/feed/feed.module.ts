import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeedService } from './feed.service';
import { FeedController } from './feed.controller';
import { PublicFeedController } from './public-feed.controller';

@Module({
  imports: [AuthModule],
  controllers: [FeedController, PublicFeedController],
  providers: [FeedService],
})
export class FeedModule {}
