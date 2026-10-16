/**
 * AI Marketing Performance Analyst (rule-based, no external LLM).
 * Analyzes a dashboard view (src/report.js → buildView) and generates actionable recommendations
 * for the 4 target products: UCMAS, UCKID, MATHCA, TRẠI HÈ.
 *
 * Primary conversion = messages / leads, so CPA (cost per message) drives the scoring.
 * Thresholds are documented in PROJECT_CONTEXT.md §8 — do not change without owner approval.
 */

export const THRESHOLDS = {
  CPA_GOOD: 65000,          // ≤ → tốt
  CPA_OK: 90000,            // ≤ → trung bình - khá, > → cao
  WIN_MIN_MESSAGES: 10,     // chiến dịch win: ≥ 10 tin & CPA ≤ CPA_GOOD
  WASTE_ZERO_CONV_SPEND: 1200000,
  WASTE_HIGH_CPA_SPEND: 2000000,
  WASTE_HIGH_CPA: 130000,
  FATIGUE_FREQUENCY: 3.0,
  CTR_LOW: 1.2,
  CTR_HIGH: 2.0
};

const vnd = (n) => `${Math.round(n || 0).toLocaleString('vi-VN')} ₫`;

/**
 * Classify a single campaign. Single source of truth for the "Đánh giá AI" column
 * and the recommendation cards. Priority: scale > cut_or_review > fatigue_alert > maintain.
 *
 * @param {object} c campaign row from buildView
 * @param {boolean} fatigueApplicable Meta only reports `frequency` for the sync window
 *   (reach is de-duplicated, so it cannot be re-derived for a shorter range). When the
 *   view shows a different range we skip the fatigue rule instead of judging it with a
 *   number that belongs to another period — see quy-tac-du-an.md §4.
 */
export function classifyCampaign(c, fatigueApplicable = true) {
  if (c.effective_status !== 'ACTIVE') return 'maintain';
  const T = THRESHOLDS;
  if (c.messages >= T.WIN_MIN_MESSAGES && c.cpa > 0 && c.cpa <= T.CPA_GOOD) return 'scale';
  if ((c.spend > T.WASTE_ZERO_CONV_SPEND && c.messages === 0) ||
      (c.spend > T.WASTE_HIGH_CPA_SPEND && c.cpa > T.WASTE_HIGH_CPA)) return 'cut_or_review';
  if (fatigueApplicable && c.frequency >= T.FATIGUE_FREQUENCY) return 'fatigue_alert';
  return 'maintain';
}

export function generateAnalysis(view) {
  const T = THRESHOLDS;
  const summary = view.summary || {};
  const campaigns = view.campaigns || [];
  const products = view.products || [];

  const recommendations = [];
  const topPerformers = [];
  const moneyWasters = [];
  const fatigueAlerts = [];

  let healthScore = 75; // Baseline

  // 1. CPA (cost per message) of the selected scope
  const cpa = summary.avgCpa || 0;
  const totalMessages = summary.totalMessages || 0;
  if (totalMessages > 0) {
    if (cpa <= T.CPA_GOOD) {
      healthScore += 15;
      recommendations.push({ type: 'success', title: 'Chi phí mỗi tin nhắn (CPA) rất tốt',
        message: `CPA trung bình ${vnd(cpa)}/tin nhắn với ${totalMessages.toLocaleString('vi-VN')} tin nhắn.` });
    } else if (cpa <= T.CPA_OK) {
      healthScore += 5;
      recommendations.push({ type: 'info', title: 'CPA ở mức trung bình - khá',
        message: `CPA ${vnd(cpa)}/tin nhắn. Có thể giảm xuống dưới ${vnd(T.CPA_GOOD)} bằng cách lọc vị trí và test creative mới.` });
    } else {
      healthScore -= 15;
      recommendations.push({ type: 'warning', title: `CPA đang cao (> ${vnd(T.CPA_OK)})`,
        message: `CPA trung bình ${vnd(cpa)}/tin nhắn. Cần tinh chỉnh kịch bản tin nhắn và thu hẹp tệp phụ huynh.` });
    }
  }

  // 2. Compare the 4 target products (only those with spend)
  const activeProducts = products.filter(p => p.spend > 0);
  const byCpa = activeProducts.filter(p => p.messages > 0).sort((a, b) => a.cpa - b.cpa);
  if (byCpa.length > 0) {
    const best = byCpa[0];
    const worst = byCpa[byCpa.length - 1];
    const totalAll = products.reduce((a, p) => a + p.spend, 0);
    const topSpend = [...activeProducts].sort((a, b) => b.spend - a.spend)[0];
    let msg = `[${best.name}] có CPA tốt nhất: ${vnd(best.cpa)}/tin (${best.messages.toLocaleString('vi-VN')} tin). `;
    if (worst.key !== best.key) msg += `[${worst.name}] có CPA cao nhất: ${vnd(worst.cpa)}/tin. `;
    if (topSpend && totalAll > 0) msg += `[${topSpend.name}] chiếm ${Math.round((topSpend.spend / totalAll) * 100)}% tổng chi tiêu 4 sản phẩm.`;
    recommendations.push({ type: 'info', title: 'So sánh 4 sản phẩm', message: msg });
  }

  // 3. Click-through rate
  const ctr = summary.avgCtr || 0;
  if (summary.totalImpressions > 0) {
    if (ctr < T.CTR_LOW) {
      healthScore -= 10;
      recommendations.push({ type: 'warning', title: `CTR thấp (< ${T.CTR_LOW}%)`,
        message: `CTR trung bình ${ctr}%. Creative / 3 giây đầu chưa đủ thu hút phụ huynh.` });
    } else if (ctr >= T.CTR_HIGH) {
      healthScore += 10;
      recommendations.push({ type: 'success', title: `CTR cao (≥ ${T.CTR_HIGH}%)`,
        message: `CTR đạt ${ctr}%. Nội dung tạo được sự tò mò tốt với tệp phụ huynh.` });
    }
  }

  // 4. Classify each campaign
  const fatigueApplicable = view.fatigueApplicable !== false;
  for (const c of campaigns) {
    c.recommendation = classifyCampaign(c, fatigueApplicable);
    const base = { id: c.id, name: c.name, product: c.productLabel, accountName: c.accountName,
      spend: c.spend, cpa: c.cpa, messages: c.messages, frequency: c.frequency };

    if (c.recommendation === 'scale') {
      topPerformers.push({ ...base, advice: 'Tăng dần ngân sách 15% - 20% mỗi 48h để không reset máy học.' });
    } else if (c.recommendation === 'cut_or_review') {
      moneyWasters.push({ ...base,
        reason: c.messages === 0 ? 'Chi tiêu cao nhưng 0 tin nhắn' : `CPA quá đắt (${vnd(c.cpa)}/tin)`,
        action: 'Tạm dừng hoặc thay mẫu tin nhắn chào mừng / creative để tránh hao phí ngân sách.' });
      healthScore -= 6;
    } else if (c.recommendation === 'fatigue_alert') {
      fatigueAlerts.push({ ...base,
        advice: `Tần suất ${c.frequency.toFixed(2)} — khách đã xem quá nhiều lần. Thay creative hoặc mở rộng tệp.` });
    }
  }

  healthScore = Math.max(10, Math.min(100, healthScore));

  let statusLabel = 'Khỏe mạnh & Tăng trưởng tốt';
  let statusLevel = 'good';
  if (healthScore < 60) { statusLabel = 'Cần tối ưu khẩn cấp'; statusLevel = 'bad'; }
  else if (healthScore < 80) { statusLabel = 'Hoạt động trung bình'; statusLevel = 'warn'; }

  const fatiguePart = fatigueApplicable
    ? `${fatigueAlerts.length} chiến dịch có dấu hiệu bão hòa`
    : 'chưa đánh giá bão hòa (tần suất chỉ đo được cho kỳ đồng bộ)';

  return {
    healthScore,
    statusLabel,
    statusLevel,
    thresholds: THRESHOLDS,
    fatigueApplicable,
    recommendations,
    topPerformers,
    moneyWasters,
    fatigueAlerts,
    executiveSummary: `Điểm sức khỏe ${healthScore}/100. Có ${topPerformers.length} chiến dịch tin nhắn giá tốt nên scale, ${moneyWasters.length} chiến dịch CPA cao hoặc chưa ra tin nhắn cần rà soát, ${fatiguePart}.`
  };
}
