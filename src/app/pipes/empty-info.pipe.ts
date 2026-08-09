import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  standalone: false,
  name: 'emptyInfo'
})
export class EmptyInfoPipe implements PipeTransform {

  transform(value: string | number | null | undefined): string {
    // 檢查是否為 null 或 undefined，或者是空字串
    if (value === null || value === undefined || value === '') {
      return '暫無資訊';
    }
    // 否則返回轉為字串的值
    return value.toString();
  }

}
