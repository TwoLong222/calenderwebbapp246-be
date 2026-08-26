import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ExtractEventsDto {
  /** Text đã trích từ file PDF (frontend dùng pdfjs-dist đọc trước khi gửi lên). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(15000)
  text!: string;
}
