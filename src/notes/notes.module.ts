import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';

@Module({
  imports: [AuthModule],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
