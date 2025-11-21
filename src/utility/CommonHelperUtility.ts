export class CommonHelperUtility {

    static generateGuid(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
    }

    static generateRandomString(length: number): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        let result = '';
        for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        result += chars[randomIndex];
        }
        return result;
    }

    static removeNestedParentheses(str: string): string {
        let openCount = 0;
        let result = '';
        for (let i = 0; i < str.length; i++) {
            const char = str[i];

            if (char === '(') {
            if (openCount === 0) {
                result += char;
            }
            openCount++;
            } else if (char === ')') {
            openCount--;
            if (openCount === 0) {
                result += char;
            }
            } else if (openCount <= 1) {
            result += char;
            }
        }
        return result;
    }

    static stringToFixedNumber(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charCodeAt(i);
            hash = (hash << 5) - hash + chr;
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash); // Optional: to make it non-negative
    }

    static toLocalISOString(date: Date): string {
        const pad = (num: number): string => num.toString().padStart(2, '0');

        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1); // getMonth is 0-indexed
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());

        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }
}