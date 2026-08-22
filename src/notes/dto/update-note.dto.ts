import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { NOTE_COLORS } from './create-note.dto';
import type { NoteColor } from './create-note.dto';

export class UpdateNoteDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) content?: string;
  @IsOptional() @IsString() @IsIn(NOTE_COLORS) color?: NoteColor;
  @IsOptional() @IsBoolean() pinned?: boolean;
}
