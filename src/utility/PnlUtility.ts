// src/utils/PnlUtility.ts

export interface SLLossInput {
  side: 'BUY' | 'SELL'
  entryPrice: number
  slPrice: number
  positionCost: number // in USDT
  leverage: number // default 1 if not using leverage
}

export interface SLLossOutput {
  priceDifference: number
  priceChangePercent: number
  lossAmount: number
  remainingBalance: number
  lossPercent: number
}

export class PnlUtility {
  private static readonly MAKER_FEE = 0.0002 // 0.0200%
  private static readonly TAKER_FEE = 0.0005 // 0.0500%

  /**
   * Calculate estimated loss if SL is hit
   * @param input - Object containing side, entryPrice, slPrice, positionCost, leverage
   * @returns Object with loss calculations
   */
  static calculateSLLoss(input: SLLossInput): SLLossOutput {
    const { side, entryPrice, slPrice, positionCost, leverage = 1 } = input

    let priceDifference = 0

    if (side === 'BUY') {
      // For BUY: loss when price goes down
      priceDifference = entryPrice - slPrice
    } else if (side === 'SELL') {
      // For SELL: loss when price goes up
      priceDifference = slPrice - entryPrice
    }

    // ROI percent based on leverage (matches your Python formula)
    const roiPercent = (priceDifference / entryPrice) * leverage * 100
    
    // Loss amount in USDT
    const lossAmount = (positionCost * roiPercent) / 100
    
    const remainingBalance = positionCost - lossAmount

    return {
      priceDifference: Math.abs(priceDifference),
      priceChangePercent: Math.abs((priceDifference / entryPrice) * 100),
      lossAmount: Math.abs(lossAmount),
      remainingBalance,
      lossPercent: Math.abs(roiPercent)
    }
  }
    static calculatePNLPercent(
    entryPrice: number,
    currentPrice: number,
    side: string,
    leverage: number = 1
  ): number {
    let priceChangePercent: number;

    if (side === "BUY") {
      priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      priceChangePercent = ((entryPrice - currentPrice) / entryPrice) * 100;
    }

    const pnlPercent = priceChangePercent * leverage;
    return Math.round(pnlPercent * 100) / 100;
  }

  static calculateEstimatedPnl(margin:number, pnlPercentage: number, leverage: number) {
    if (!isFinite(pnlPercentage) || margin <= 0 || leverage <= 0) return 0;

    const takerFeeRate = 0.0005; // 0.05%
    const grossPnlUsdt = (pnlPercentage / 100) * margin;
    const exitFeeUsdt = margin * leverage * takerFeeRate;

    return  grossPnlUsdt - exitFeeUsdt;
  }

  static calculateTakerFee(margin: number, leverage: number) {
    const takerFeeRate = 0.0005; // 0.05%
    const positionNotional = margin * leverage;
    return positionNotional * takerFeeRate;
  }

  /**
   * Safe wrapper for SL loss calculation with error handling
   */
  static estimateSLLoss(
    side: string,
    currentPrice: number,
    slPrice: number,
    positionCost: string,
    leverage: number = 1
  ): SLLossOutput | null {
    if (!currentPrice || !slPrice || !positionCost) {
      return null
    }

    try {
      return this.calculateSLLoss({
        side: side as 'BUY' | 'SELL',
        entryPrice: currentPrice,
        slPrice: slPrice,
        positionCost: parseFloat(positionCost),
        leverage
      })
    } catch (err) {
      console.error('Error calculating SL loss:', err)
      return null
    }
  }

  /**
   * Calculate net PnL after fees
   */
  static calculateNetPnlPrecise(
    unrealizedPnl: number,
    positions: any[]
  ): number {
    // Return gross PnL if no positions or invalid data
    if (!positions || !Array.isArray(positions) || positions.length === 0) {
      return unrealizedPnl
    }

    let totalFees = 0

    try {
      positions.forEach((position: any) => {
        const positionAmt = parseFloat(position.positionAmt)
        const entryPrice = parseFloat(position.entryPrice)
        const markPrice = parseFloat(position.markPrice)

        // Skip if any value is NaN
        if (isNaN(positionAmt) || isNaN(entryPrice) || isNaN(markPrice)) {
          return
        }

        const entryNotional = Math.abs(positionAmt * entryPrice)
        const exitNotional = Math.abs(positionAmt * markPrice)

        // Entry fee (taker - worst case)
        const entryFee = entryNotional * this.TAKER_FEE

        // Exit fee (taker - worst case)
        const exitFee = exitNotional * this.TAKER_FEE

        totalFees += entryFee + exitFee
      })
    } catch (err) {
      console.error('Error calculating fees:', err)
      return unrealizedPnl
    }

    if (isNaN(totalFees) || totalFees < 0) {
      return unrealizedPnl
    }

    const netPnl = unrealizedPnl - totalFees
    return isNaN(netPnl) ? unrealizedPnl : netPnl
  }
}