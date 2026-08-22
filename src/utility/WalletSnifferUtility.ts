import type { TokenMapEntry } from "@/core/interfaces"

export type TokenMap = Record<string, TokenMapEntry>

export class WalletSnifferUtility {
    static async getTokenMap(): Promise<TokenMap> {
        try {
            const response = await fetch(import.meta.env.VITE_WALLET_SNIFFER_API + `/api/tokenmap`)

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            const data: TokenMap = await response.json()
            return data
        } catch (error) {
            console.error('Error fetching token map:', error)
            throw error
        }
    }
}