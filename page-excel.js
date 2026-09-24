/**
 * page-excel.js
 * Excel Manager & Data Importer/Exporter (macOS / SheetJS Pro)
 * Drag-and-drop workbook parser, column auto-matcher, queue feeder, and styled Excel exporter.
 */
'use strict';

const ExcelCtrl = {
  importedRows: [],
  fileName: '',
  parsedColumns: [],

  init() {
    this.updateExportStats();
    this.bindEvents();
  },

  bindEvents() {
    const dropzone = document.getElementById('excel-dropzone');
    const fileInputs = [
      document.getElementById('excel-import-file'),
      document.getElementById('excel-file-input')
    ].filter(Boolean);

    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--do-blue, #007aff)';
        dropzone.style.background = 'rgba(0,122,255,0.04)';
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = '#dadce0';
        dropzone.style.background = '#fafafa';
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = '#dadce0';
        dropzone.style.background = '#fafafa';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.handleFile(e.dataTransfer.files[0]);
        }
      });
    }

    fileInputs.forEach(inp => {
      inp.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleFile(e.target.files[0]);
        }
      });
    });
  },

  // ── Import File Handling ──
  async handleFile(file) {
    if (!file) return;
    this.fileName = file.name;

    try {
      if (!window.ClavisEnrichmentEngine) {
        if (window.showToast) window.showToast('Enrichment engine is loading. Please try again.', 'warning');
        return;
      }

      const parsed = await window.ClavisEnrichmentEngine.parseFile(file, file.name);
      this.parsedData = parsed;
      this.parsedColumns = Object.keys(parsed.rows[0]?.raw || {});
      this.importedRows = parsed.rows.map(r => r.raw);

      this.renderImportPreview(parsed);
      const batchCount = Math.ceil(parsed.totalRows / 50);
      if (window.showToast) {
        window.showToast(`Imported ${parsed.totalRows} companies from "${file.name}" (${batchCount} batches of 50)!`, 'success');
      }

    } catch (err) {
      if (window.showToast) window.showToast('Error reading Excel file: ' + err.message, 'error');
      else alert('Error parsing spreadsheet: ' + err.message);
    }
  },

  renderImportPreview(parsed) {
    const previewBox = document.getElementById('excel-import-preview');
    const filenameEl = document.getElementById('excel-import-filename');
    const rowcountEl = document.getElementById('excel-import-rowcount');
    const colSelect = document.getElementById('excel-column-select');
    const importBtn = document.getElementById('excel-import-btn');
    const pushBtn = document.getElementById('excel-push-btn');

    const totalRows = parsed.totalRows || 0;
    const batchCount = Math.ceil(totalRows / 50);

    if (previewBox) previewBox.style.display = 'block';
    if (filenameEl) filenameEl.textContent = this.fileName;
    if (rowcountEl) rowcountEl.textContent = `${totalRows} Companies · ${batchCount} ${batchCount === 1 ? 'Batch' : 'Batches of 50'}`;

    if (colSelect && this.parsedColumns) {
      colSelect.innerHTML = this.parsedColumns.map((h, i) => {
        const isSelected = h === parsed.detectedColumns?.company || /company|name|business|organization|firm|client/i.test(h) || i === 0;
        return `<option value="${h}" ${isSelected ? 'selected' : ''}>${h}</option>`;
      }).join('');
    }

    if (importBtn) {
      importBtn.disabled = false;
      importBtn.style.opacity = '1';
      importBtn.style.cursor = 'pointer';
      importBtn.innerHTML = `⚡ Start Deep Enrichment (${batchCount} ${batchCount === 1 ? 'batch' : 'batches of 50'})`;
    }
    if (pushBtn) pushBtn.disabled = false;
  },

  // ── Deep Enrichment with 50-Row Chunks and Single Excel Export ──
  async startEnrichment() {
    if (!this.parsedData || !this.parsedData.rows || !this.parsedData.rows.length) {
      if (window.showToast) window.showToast('No companies to enrich. Please upload an Excel or CSV first.', 'warning');
      return;
    }

    const importBtn = document.getElementById('excel-import-btn');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.textContent = '⏳ Enriching Companies (Chunks of 50)...';
    }

    const previewBox = document.getElementById('excel-import-preview');
    let progressBox = document.getElementById('excel-enrichment-progress');
    if (!progressBox && previewBox) {
      progressBox = document.createElement('div');
      progressBox.id = 'excel-enrichment-progress';
      progressBox.style.marginTop = '16px';
      previewBox.appendChild(progressBox);
    }

    try {
      await window.ClavisEnrichmentEngine.runEnrichmentPipeline({
        parsedData: this.parsedData,
        onProgress: (p) => {
          if (progressBox) {
            progressBox.innerHTML = `
              <div class="clavis-enrichment-card" style="padding:14px; margin:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:600;">
                  <span>Batch ${p.batchIndex} of ${p.totalBatches} · Processing row ${p.processedCount}/${p.totalCount}</span>
                  <span style="color:var(--do-blue, #6366f1); font-weight:700;">${p.percent}%</span>
                </div>
                <div class="enr-progress-bar" style="margin:8px 0;">
                  <div class="enr-progress-fill" style="width:${p.percent}%;"></div>
                </div>
                ${p.currentCompany ? `<div style="font-size:11.5px; color:var(--do-t2, #6b7280); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🏢 Current: <strong>${p.currentCompany}</strong></div>` : ''}
                <div class="enr-stats-row" style="margin-top:6px;">
                  <span class="enr-stats-item">🌐 ${p.stats?.websitesFound || 0} Sites</span>
                  <span class="enr-stats-item">📞 ${p.stats?.phonesFound || 0} Phones</span>
                  <span class="enr-stats-item">✉️ ${p.stats?.emailsFound || 0} Emails</span>
                </div>
              </div>
            `;
          }
        },
        onComplete: (c) => {
          if (importBtn) {
            importBtn.disabled = false;
            importBtn.textContent = '✅ Enriched & Exported to Single Excel!';
            importBtn.style.background = '#10b981';
          }
          if (progressBox) {
            progressBox.innerHTML = `
              <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:8px; padding:14px; margin-top:8px;">
                <div style="color:#10b981; font-weight:700; font-size:13px; margin-bottom:4px;">
                  ✅ All ${c.totalRecords} Companies Enriched in Single Excel File!
                </div>
                <p style="font-size:12px; color:var(--do-t2, #4b5563); margin:0 0 10px 0;">
                  Google Maps and website contact info scraped and compiled into one consolidated file.
                </p>
                <div style="display:flex; gap:8px;">
                  <button class="enr-btn-primary" onclick="ClavisEnrichmentEngine.generateConsolidatedExcel(window.allLeads.slice(0, ${c.totalRecords}), '${this.fileName}')">
                    📥 Download Consolidated Excel (.xlsx)
                  </button>
                  <button class="enr-btn-secondary" onclick="showView('leads')">
                    👥 View in Leads Database
                  </button>
                </div>
              </div>
            `;
          }
          if (window.showToast) window.showToast(`Enriched ${c.totalRecords} companies into single Excel!`, 'success');
        },
        onError: (err) => {
          if (importBtn) {
            importBtn.disabled = false;
            importBtn.textContent = '⚡ Retry Enrichment';
          }
          if (window.showToast) window.showToast('Enrichment error: ' + err.message, 'error');
        }
      });
    } catch (e) {
      console.error(e);
    }
  },

  // ── Push / Enrich Leads ──
  pushToLeadsDB() {
    this.startEnrichment();
  },

  // ── Export Stats ──
  updateExportStats() {
    let all = [];
    try {
      all = JSON.parse(localStorage.getItem('allLeads') || '[]');
    } catch(e) {}

    const totalEls = [
      document.getElementById('excel-total-leads'),
      document.getElementById('excel-export-total')
    ].filter(Boolean);

    const newEls = [
      document.getElementById('excel-unsaved-leads'),
      document.getElementById('excel-export-new')
    ].filter(Boolean);

    const total = all.length;
    const newCount = all.filter(l => !l.status || l.status.toLowerCase() === 'new').length;

    totalEls.forEach(el => el.textContent = total);
    newEls.forEach(el => el.textContent = newCount);
  },

  // ── Export to Excel (.xlsx) / CSV ──
  exportLeads(format = 'xlsx') {
    let all = [];
    try {
      all = JSON.parse(localStorage.getItem('allLeads') || '[]');
    } catch(e) {}

    if (all.length === 0) {
      if (window.showToast) window.showToast('No leads available to export. Discover or import leads first!', 'warning');
      else alert('No leads available to export.');
      return;
    }

    const sheetName = document.getElementById('excel-sheet-name')?.value || 'Verified Leads';

    const rows = all.map((l, i) => ({
      '#': i + 1,
      'Company Name': l.company || '',
      'City / Region': l.city || '',
      'State / Zone': l.state || 'Delhi NCR',
      'Target Industry': l.industry || '',
      'Service Required': l.serviceType || 'Security & Housekeeping',
      'Contact Person / Role': l.jobTitle || 'Facility & Security Manager',
      'Phone Number': l.phone || '',
      'Email Address': l.email || '',
      'Website URL': l.website || '',
      'Lead Score / Opportunity': l.score || l.leadScore || 85,
      'Lead Status': l.status || 'New',
      'Discovery Source': l.source || 'AI Agent',
      'Date Discovered': l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN')
    }));

    if (format === 'csv' || typeof XLSX === 'undefined') {
      this.exportCsvFallback(rows);
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);

    // Auto-fit column widths
    const colWidths = Object.keys(rows[0]).map(key => {
      const maxLen = Math.max(
        key.length,
        ...rows.map(r => String(r[key] || '').length)
      );
      return { wch: Math.min(45, maxLen + 3) };
    });
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

    const fileName = `${((window.UserProfileManager?.getProfile?.().company || 'Leads').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'') || 'Leads')}_Verified_Leads_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);

    if (window.showToast) {
      window.showToast(`Exported ${all.length} verified leads to ${fileName}!`, 'success');
    }
  },

  exportCsvFallback(rows) {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${((window.UserProfileManager?.getProfile?.().company || 'Leads').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'') || 'Leads')}_Verified_Leads_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    if (window.showToast) {
      window.showToast(`Exported CSV file successfully!`, 'success');
    }
  }
};

// Global Bridges
window.ExcelCtrl = ExcelCtrl;
window.initExcelView = () => ExcelCtrl.init();
window.handleExcelImport = (e) => {
  if (e && e.target && e.target.files && e.target.files[0]) {
    ExcelCtrl.handleFile(e.target.files[0]);
  }
};
window.processExcelImport = () => ExcelCtrl.pushToLeadsDB();
window.processExcelPush = () => ExcelCtrl.pushToLeadsDB();
window.exportToExcel = () => ExcelCtrl.exportLeads('xlsx');
window.exportToCSV = () => ExcelCtrl.exportLeads('csv');
window.exportExcelLeads = (fmt) => ExcelCtrl.exportLeads(fmt);

document.addEventListener('DOMContentLoaded', () => {
  ExcelCtrl.init();
});
