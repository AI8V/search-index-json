(function () {
    'use strict';

    /**
     * =================================================================
     * M O D U L E: StateManager
     * -----------------------------------------------------------------
     * مسؤول عن إدارة حالة التطبيق المركزية والبيانات الثابتة.
     * =================================================================
     */
    const StateManager = (function () {
        const DEFAULT_BASE_SCHEMA_OBJ = { "@context": "https://schema.org", "@type": ["WebSite", "Organization"], "@id": "https://example.com/#website", name: "Your Organization Name", url: "https://example.com", logo: "https://example.com/logo.png", sameAs: ["https://www.facebook.com/your-profile", "https://twitter.com/your-profile"], potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: "https://example.com/search?q={search_term_string}" }, "query-input": "required name=search_term_string" } };
        const DEFAULT_BASE_SCHEMA_STR = JSON.stringify(DEFAULT_BASE_SCHEMA_OBJ, null, 2);

        const appState = {
            searchIndex: [], manualPages: [], analyzedFiles: [], sitemapUrls: [],
            robotsUrls: [], manifestData: {}, filteredResults: [],
            selectedItemIds: new Set(),
            schemaConfig: { baseUrl: '', pageSchemaType: 'WebPage', baseSchema: DEFAULT_BASE_SCHEMA_STR }
        };

        const CONSTANTS = {
            PROJECTS_MASTER_KEY: 'searchIndexGenerator_projects',
            LAST_PROJECT_KEY: 'searchIndexGenerator_lastProject',
            VIRTUAL_SCROLL_CHUNK_SIZE: 15
        };

        function resetAppState() {
            Object.assign(appState, {
                searchIndex: [], manualPages: [], analyzedFiles: [], sitemapUrls: [],
                robotsUrls: [], manifestData: {}, filteredResults: [],
                schemaConfig: { baseUrl: '', pageSchemaType: 'WebPage', baseSchema: DEFAULT_BASE_SCHEMA_STR }
            });
            appState.selectedItemIds.clear();
        }

        return { appState, CONSTANTS, DEFAULT_BASE_SCHEMA_STR, resetAppState };
    })();

    /**
     * =================================================================
     * M O D U L E: DOMManager
     * -----------------------------------------------------------------
     * مسؤول عن إدارة جميع عناصر الـ DOM وتوفير مرجع مركزي لها.
     * =================================================================
     */
    const DOMManager = (function () {
        const dom = {};
        const domIds = ['darkModeToggle', 'liveCounter', 'counterValue', 'seoCrawlerUrl', 'seoCrawlerDepth', 'seoCrawlerConcurrency', 'seoCrawlerDelay', 'seoCrawlerNoSaveHtml', 'customProxyUrl', 'urlInput', 'manualInput', 'manualInputSection', 'projectSelector', 'projectNameInput', 'showAnalyticsBtn', 'analyticsModal', 'sourceDistributionChart', 'topKeywordsChart', 'averageSeoScoreChart', 'seoScoreText', 'orphanPagesCard', 'orphanPagesCount', 'viewOrphanPagesBtn', 'filterSection', 'categoryFilter', 'keywordFilter', 'orphanFilter', 'selectionControls', 'selectionCounter', 'results', 'resultsAccordion', 'resultsPlaceholder', 'exportButtons', 'downloadJsonBtn', 'downloadCsvBtn', 'downloadZipBtn', 'toggleCopyBtn', 'exportReportBtn', 'zipProgress', 'zipProgressBar', 'copyOptions', 'schemaGeneratorSection', 'schemaBaseUrl', 'schemaPageType', 'schemaBaseEditor', 'crawlerStatus', 'crawlerCurrentUrl', 'crawlerProgressBar', 'crawlerProgressText', 'crawlerQueueCount', 'urlsFileInput', 'resultItemTemplate', 'robotsDropZone', 'robotsFileInput', 'manifestDropZone', 'manifestFileInput', 'sitemapDropZone', 'sitemapFileInput', 'fileDropZone', 'htmlFileInput', 'reportModal', 'reportModalBody', 'printReportBtn', 'startCrawlerBtn', 'importUrlsFileBtn', 'addManualPageBtn', 'generateIndexBtn', 'saveProjectBtn', 'deleteProjectBtn', 'clearFormBtn', 'selectAllBtn', 'deselectAllBtn', 'hideCrawlerStatusBtn', 'generateSchemaBtn'];
        
        const getEl = (id) => document.getElementById(id);
        
        function init() {
            domIds.forEach(id => {
                const el = getEl(id);
                if (el) {
                    dom[id] = el;
                }
            });
        }
        
        return { init, dom, getEl };
    })();

    /**
     * =================================================================
     * M O D U L E: Utils
     * -----------------------------------------------------------------
     * يحتوي على دوال مساعدة عامة تستخدم في جميع أنحاء التطبيق.
     * =================================================================
     */
    const Utils = (function (DOM) {
        function showNotification(message, type = 'info', duration = 5000) {
            const container = document.querySelector('.toast-container');
            const colors = { info: 'bg-info text-white', success: 'bg-success text-white', warning: 'bg-warning text-dark', danger: 'bg-danger text-white' };
            const toast = Object.assign(document.createElement('div'), {
                id: 'toast-' + Date.now(), className: `toast align-items-center ${colors[type]} border-0`,
                role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true'
            });
            toast.innerHTML = `<div class="d-flex align-items-center"><div class="toast-body flex-grow-1">${message}</div><button type="button" class="btn-close ${type === 'warning' ? 'btn-close-dark' : 'btn-close-white'} ms-2" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
            container.appendChild(toast);
            const bsToast = new bootstrap.Toast(toast, { delay: duration }); bsToast.show();
            toast.addEventListener('hidden.bs.toast', () => toast.remove());
        }

        function getProxyUrl(targetUrl) {
            const customProxy = DOM.dom.customProxyUrl.value.trim();
            return customProxy ? customProxy.replace('{url}', encodeURIComponent(targetUrl)) : `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        }
        
        const downloadFile = (blob, filename) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href); };
        const readFileContent = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = e => resolve(e.target.result); reader.onerror = reject; reader.readAsText(file); });
        
        return { showNotification, getProxyUrl, downloadFile, readFileContent };
    })(DOMManager);
    
    /**
     * =================================================================
     * M O D U L E: Analyzer
     * -----------------------------------------------------------------
     * مسؤول عن منطق تحليل المحتوى وحساب التقييمات.
     * =================================================================
     */
    const Analyzer = (function () {
        function analyzeHtmlContent(content, urlOrFilename, options = {}) {
            const doc = new DOMParser().parseFromString(content, 'text/html');
            const isUrl = urlOrFilename.startsWith('http');
            const url = isUrl ? new URL(urlOrFilename) : null;
            const filename = isUrl ? (url.pathname.split('/').pop() || 'index.html') : urlOrFilename;
        
            let pageTypeHint = 'generic';
            const lowerUrl = urlOrFilename.toLowerCase();
            if (lowerUrl.includes('/blog/') || lowerUrl.includes('/article/')) pageTypeHint = 'article';
            else if (lowerUrl.includes('/product')) pageTypeHint = 'product';
            else if (lowerUrl.includes('/contact')) pageTypeHint = 'contact';
            else if (lowerUrl.includes('/about')) pageTypeHint = 'about';
            else if (filename === 'index.html' || url?.pathname === '/') pageTypeHint = 'homepage';

            const title = doc.querySelector('title')?.textContent.trim() || filename.replace(/\.(html?|htm)$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const description = doc.querySelector('meta[name="description"]')?.getAttribute('content') || doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || `صفحة ${title}`;
            const bodyText = doc.body?.textContent.trim() || '';
            const words = bodyText.split(/\s+/).filter(Boolean);
            const sentences = bodyText.match(/[^.!?]+[.!?]+/g) || [];
            const pageHostname = url?.hostname || window.location.hostname;
            
            let internalLinks = 0, externalLinks = 0;
            doc.querySelectorAll('a[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
                try {
                    const linkUrl = new URL(href, urlOrFilename);
                    if (linkUrl.hostname === pageHostname) internalLinks++;
                    else if (linkUrl.protocol.startsWith('http')) externalLinks++;
                } catch {
                    if (!/^(https?:)?\/\//.test(href)) internalLinks++;
                }
            });
            
            const syllableApproximation = words.reduce((acc, word) => acc + (word.match(/[aeiouy]{1,2}/gi) || []).length, 0);
            
            const seoData = {
                h1: doc.querySelector('h1')?.textContent.trim() || null,
                lang: doc.documentElement.getAttribute('lang') || null,
                canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
                imageAltInfo: { total: doc.images.length, missing: [...doc.images].filter(img => !img.alt?.trim()).length },
                brokenLinksOnPage: [],
                loadTime: options.loadTime || null,
                isNoIndex: /noindex/i.test(doc.querySelector('meta[name="robots"]')?.content),
                isOrphan: false,
                internalLinkEquity: 0,
                ogTitle: doc.querySelector('meta[property="og:title"]')?.content || null,
                ogImage: doc.querySelector('meta[property="og:image"]')?.content || null,
                hasStructuredData: !!doc.querySelector('script[type="application/ld+json"]'),
                wordCount: words.length, pageTypeHint,
                contentAnalysis: { internalLinks, externalLinks, readabilityScore: sentences.length > 0 && words.length > 0 ? Math.max(0, 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllableApproximation / words.length)).toFixed(1) : null },
                performance: { pageSizeKB: (content.length / 1024).toFixed(1), resourceCounts: { js: doc.scripts.length, css: doc.querySelectorAll('link[rel="stylesheet"]').length, images: doc.images.length } },
                accessibility: { formLabels: { total: doc.querySelectorAll('input, textarea, select').length, missing: [...doc.querySelectorAll('input:not([type=hidden]), textarea, select')].filter(el => !el.id || !doc.querySelector(`label[for="${el.id}"]`)).length }, semanticHeaders: !!doc.querySelector('header'), semanticNav: !!doc.querySelector('nav'), semanticMain: !!doc.querySelector('main') }
            };

            const result = { filename, title, description, keywords: doc.querySelector('meta[name="keywords"]')?.content?.split(',').map(k => k.trim()).filter(Boolean) || [], url: isUrl ? url.pathname : '/' + filename, source: isUrl ? 'seo_crawler' : 'html_analysis', seo: seoData };
            result.content = content;
            return result;
        }
        
        function calculateSeoScore(seo) {
            if (!seo) return { score: 0, maxScore: 9, color: '#6c757d', level: 'غير متوفر' };
            let score = 0; const maxScore = 9;
            if (seo.h1) score++;
            if (seo.canonical) score++;
            if (seo.imageAltInfo.total > 0 && seo.imageAltInfo.missing === 0) score++;
            if (seo.brokenLinksOnPage.length === 0) score++;
            if (!seo.isNoIndex) score++;
            if (seo.lang) score++;
            if (seo.ogTitle && seo.ogImage) score++;
            if (seo.hasStructuredData) score++;
            const thresholds = { article: 500, product: 250, homepage: 250, about: 50, contact: 50, generic: 300 };
            if (seo.wordCount >= (thresholds[seo.pageTypeHint] || thresholds.generic)) score++;
            const percentage = (score / maxScore) * 100;
            if (percentage >= 80) return { score, maxScore, color: '#198754', level: 'ممتاز' };
            if (percentage >= 50) return { score, maxScore, color: '#ffc107', level: 'جيد' };
            return { score, maxScore, color: '#dc3545', level: 'يحتاج لمراجعة' };
        }

        function extractTagsFromUrl(url) {
            if (!url) return [];
            try {
                const path = new URL(url, url.startsWith('http') ? undefined : 'http://dummy.com').pathname;
                const parts = path.split('/').filter(Boolean);
                const tags = parts.flatMap(p => p.replace(/\.[^/.]+$/, '').split(/[-_\s]+/)).filter(p => p.length > 2);
                const translations = { 'index': 'الرئيسية', 'home': 'الرئيسية', 'about': 'من نحن', 'contact': 'اتصل بنا', 'services': 'خدمات', 'products': 'منتجات', 'blog': 'مدونة', 'news': 'أخبار', 'portfolio': 'أعمال', 'team': 'فريق', 'pricing': 'أسعار', 'faq': 'أسئلة شائعة' };
                tags.forEach(tag => { if (translations[tag.toLowerCase()]) tags.push(translations[tag.toLowerCase()]); });
                return [...new Set(tags.map(t => t.toLowerCase()))];
            } catch (e) { console.error("URL tag extraction failed:", url, e); return []; }
        }

        return { analyzeHtmlContent, calculateSeoScore, extractTagsFromUrl };
    })();


    /**
     * =================================================================
     * M O D U L E: UIManager
     * -----------------------------------------------------------------
     * مسؤول عن جميع تحديثات واجهة المستخدم، بما في ذلك القراءة من الـ DOM وعرض البيانات.
     * =================================================================
     */
    const UIManager = (function (State, DOM, Analyzer, Utils) {
        let sourceChartInstance, keywordsChartInstance, seoScoreChartInstance, scrollObserver;

        const getProjectName = () => DOM.dom.projectNameInput.value.trim();
        const getSelectedProjectName = () => DOM.dom.projectSelector.value;
        const getSeoCrawlerConfig = () => ({ 
            baseUrl: DOM.dom.seoCrawlerUrl.value.trim(), 
            maxDepth: parseInt(DOM.dom.seoCrawlerDepth.value, 10) || 0, 
            concurrency: parseInt(DOM.dom.seoCrawlerConcurrency.value, 10) || 3,
            crawlDelay: parseInt(DOM.dom.seoCrawlerDelay.value, 10) || 100, 
            saveHtmlContent: !DOM.dom.seoCrawlerNoSaveHtml.checked 
        });
        const getUrlInput = () => DOM.dom.urlInput.value.trim();
        const getCustomProxyUrl = () => DOM.dom.customProxyUrl.value.trim();
        const getManualPageData = () => ({ title: DOM.getEl('pageTitle').value.trim(), url: DOM.getEl('pageUrl').value.trim(), description: DOM.getEl('pageDescription').value.trim(), category: DOM.getEl('pageCategory').value.trim(), tags: DOM.getEl('pageTags').value.split(',').map(t => t.trim()).filter(Boolean) });
        const getFilterState = () => ({ category: DOM.dom.categoryFilter.value, keyword: DOM.dom.keywordFilter.value.toLowerCase(), isOrphan: DOM.dom.orphanFilter.checked });
        const getSchemaConfigFromDOM = () => ({ baseUrl: DOM.dom.schemaBaseUrl.value.trim(), pageSchemaType: DOM.dom.schemaPageType.value, baseSchema: DOM.dom.schemaBaseEditor.value });
        const isManualInputChecked = () => DOM.dom.manualInput.checked;

        const setFormValues = (projectData) => {
            DOM.dom.urlInput.value = projectData.urlInput || '';
            DOM.dom.customProxyUrl.value = projectData.customProxyUrl || '';
            DOM.dom.projectNameInput.value = projectData.name || '';
            DOM.dom.orphanFilter.checked = false;
            const schemaConfig = projectData.schemaConfig || {};
            DOM.dom.schemaBaseUrl.value = schemaConfig.baseUrl || '';
            DOM.dom.schemaPageType.value = schemaConfig.pageSchemaType || 'WebPage';
            DOM.dom.schemaBaseEditor.value = schemaConfig.baseSchema || State.DEFAULT_BASE_SCHEMA_STR;
        };
        const clearManualPageForm = () => ['pageTitle', 'pageUrl', 'pageDescription', 'pageCategory', 'pageTags'].forEach(id => DOM.getEl(id).value = '');
        const clearFilterInputs = () => { DOM.dom.keywordFilter.value = ''; DOM.dom.categoryFilter.value = ''; DOM.dom.orphanFilter.checked = false; };
        const setDarkMode = (isDark) => { localStorage.setItem('darkMode', String(isDark)); document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light'); updateDarkModeButton(); };
        const updateDarkModeButton = () => {
            const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
            DOM.dom.darkModeToggle.innerHTML = isDark ? `<i class="bi bi-sun-fill"></i> <span class="d-none d-sm-inline">الوضع النهاري</span>` : `<i class="bi bi-moon-stars-fill"></i> <span class="d-none d-sm-inline">الوضع الليلي</span>`;
        };
        const toggleDarkMode = () => {
            const newIsDarkMode = document.documentElement.getAttribute('data-bs-theme') !== 'dark';
            setDarkMode(newIsDarkMode);
            const modeText = newIsDarkMode ? 'الليلي' : 'النهاري';
            const icon = newIsDarkMode ? 'bi-moon-stars-fill' : 'bi-sun-fill';
            Utils.showNotification(`<i class="bi ${icon} ms-2"></i> تم تفعيل الوضع ${modeText}`, 'info');
        };

        function renderSeoSummary(seo, itemId) {
            if (!seo) return '';
            const createBadge = (text, type, title = '') => `<span class="badge bg-${type}" title="${title}">${text}</span>`;
            const pageTypeLabels = { 'generic': 'عامة', 'article': 'مقالة', 'product': 'منتج', 'contact': 'اتصال', 'about': 'من نحن', 'homepage': 'رئيسية' };
            let equityBadge = '';
            if (typeof seo.internalLinkEquity === 'number') {
                let badgeType = 'secondary';
                if (seo.internalLinkEquity > 10) badgeType = 'warning text-dark';
                else if (seo.internalLinkEquity > 3) badgeType = 'info';
                equityBadge = `<div class="seo-summary-item"><strong>قوة الصفحة:</strong> ${createBadge(seo.internalLinkEquity, badgeType, 'قوة الربط الداخلي: عدد الروابط الداخلية التي تشير لهذه الصفحة.')}</div>`;
            }
            const basicSeoHtml = `<div class="mt-2 pt-2 border-top border-opacity-10"><strong class="small text-body-secondary d-block mb-1">SEO أساسي:</strong><div class="seo-summary-item"><strong>نوع الصفحة:</strong> ${createBadge(pageTypeLabels[seo.pageTypeHint] || 'غير محدد', 'primary')}</div>${equityBadge}<div class="seo-summary-item"><strong>H1:</strong> ${createBadge(seo.h1 ? 'موجود' : 'مفقود', seo.h1 ? 'success' : 'danger')}</div><div class="seo-summary-item"><strong>Lang:</strong> ${createBadge(seo.lang || 'مفقود', seo.lang ? 'success' : 'danger')}</div><div class="seo-summary-item"><strong>Canonical:</strong> ${createBadge(seo.canonical ? 'موجود' : 'مفقود', seo.canonical ? 'success' : 'danger')}</div><div class="seo-summary-item"><strong>Img Alt:</strong> ${seo.imageAltInfo.total === 0 ? createBadge('لا يوجد', 'secondary') : createBadge(`${seo.imageAltInfo.total - seo.imageAltInfo.missing}/${seo.imageAltInfo.total}`, seo.imageAltInfo.missing === 0 ? 'success' : 'warning')}</div><div class="seo-summary-item"><strong>روابط مكسورة:</strong> ${seo.brokenLinksOnPage?.length > 0 ? `<span class="badge bg-danger cursor-pointer" data-bs-toggle="collapse" href="#brokenLinks-${itemId}">${seo.brokenLinksOnPage.length}</span><div class="collapse mt-2" id="brokenLinks-${itemId}"><ul class="list-group list-group-flush small">${seo.brokenLinksOnPage.map(l => `<li class="list-group-item list-group-item-danger py-1 px-2 text-break">${l}</li>`).join('')}</ul></div>` : createBadge('0', 'success')}</div><div class="seo-summary-item"><strong>OG Tags:</strong> ${createBadge(seo.ogTitle && seo.ogImage ? 'موجود' : 'ناقص', seo.ogTitle && seo.ogImage ? 'success' : 'warning', 'OG:Title/Image')}</div><div class="seo-summary-item"><strong>بيانات منظمة:</strong> ${createBadge(seo.hasStructuredData ? 'موجود' : 'مفقود', seo.hasStructuredData ? 'success' : 'secondary')}</div><div class="seo-summary-item"><strong>عدد الكلمات:</strong> ${createBadge(seo.wordCount, seo.wordCount > 300 ? 'success' : 'warning')}</div></div>`;
            let contentHtml = '', performanceHtml = '', a11yHtml = '';
            if (seo.contentAnalysis) {
                const { readabilityScore, internalLinks, externalLinks } = seo.contentAnalysis;
                let readabilityBadge = createBadge('N/A', 'secondary');
                if (readabilityScore !== null) { if (readabilityScore >= 60) readabilityBadge = createBadge(readabilityScore, 'success', 'سهل القراءة'); else if (readabilityScore >= 30) readabilityBadge = createBadge(readabilityScore, 'warning', 'صعب القراءة قليلاً'); else readabilityBadge = createBadge(readabilityScore, 'danger', 'صعب القراءة جداً'); }
                contentHtml = `<div class="mt-2 pt-2 border-top border-opacity-10"><strong class="small text-body-secondary d-block mb-1">تحليل المحتوى:</strong><div class="seo-summary-item"><strong>سهولة القراءة:</strong> ${readabilityBadge}</div><div class="seo-summary-item"><strong>روابط داخلية:</strong> ${createBadge(internalLinks, 'info')}</div><div class="seo-summary-item"><strong>روابط خارجية:</strong> ${createBadge(externalLinks, 'info')}</div></div>`;
            }
            if (seo.performance) performanceHtml = `<div class="mt-2 pt-2 border-top border-opacity-10"><strong class="small text-body-secondary d-block mb-1">مقاييس الأداء:</strong><div class="seo-summary-item"><strong>حجم الصفحة:</strong> ${createBadge(`${seo.performance.pageSizeKB} KB`, seo.performance.pageSizeKB > 500 ? 'warning' : 'success')}</div><div class="seo-summary-item" title="JS / CSS / Images"><strong>الموارد:</strong> ${createBadge(`${seo.performance.resourceCounts.js}/${seo.performance.resourceCounts.css}/${seo.performance.resourceCounts.images}`, 'secondary')}</div></div>`;
            if (seo.accessibility) {
                const { formLabels, semanticHeaders, semanticNav, semanticMain } = seo.accessibility;
                const formLabelsBadge = formLabels.total === 0 ? createBadge('لا يوجد', 'secondary') : createBadge(formLabels.missing === 0 ? 'ممتاز' : `${formLabels.missing} خطأ`, formLabels.missing === 0 ? 'success' : 'danger', `${formLabels.missing} عنصر بدون label`);
                const semanticsScore = [semanticHeaders, semanticNav, semanticMain].filter(Boolean).length;
                const semanticsBadge = createBadge(semanticsScore === 3 ? 'ممتاز' : (semanticsScore > 0 ? 'ناقص' : 'مفقود'), semanticsScore === 3 ? 'success' : (semanticsScore > 0 ? 'warning' : 'danger'));
                a11yHtml = `<div class="mt-2 pt-2 border-top border-opacity-10"><strong class="small text-body-secondary d-block mb-1">إمكانية الوصول (a11y):</strong><div class="seo-summary-item"><strong>Labels للنماذج:</strong> ${formLabelsBadge}</div><div class="seo-summary-item"><strong>بنية دلالية:</strong> ${semanticsBadge}</div></div>`;
            }
            return basicSeoHtml + contentHtml + performanceHtml + a11yHtml;
        }

        const handleIntersection = (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const sentinel = entry.target;
                    scrollObserver.unobserve(sentinel); 
                    handleLoadMore(sentinel);
                }
            });
        };

        function renderItemChunk(container, items, offset) {
            const fragment = document.createDocumentFragment();
            const itemsToRender = items.slice(offset, offset + State.CONSTANTS.VIRTUAL_SCROLL_CHUNK_SIZE);
            itemsToRender.forEach(item => {
                const { id, title, url, description, category, tags, seo } = item;
                const itemClone = DOM.dom.resultItemTemplate.content.cloneNode(true);
                const seoScore = Analyzer.calculateSeoScore(seo);
                const resultItemEl = itemClone.querySelector('.result-item');
                resultItemEl.dataset.id = id;
                resultItemEl.classList.toggle('selected', State.appState.selectedItemIds.has(id));
                const seoDot = itemClone.querySelector('.seo-score-dot');
                seoDot.style.backgroundColor = seoScore.color;
                seoDot.title = `تقييم SEO: ${seoScore.level} (${seoScore.score}/${seoScore.maxScore})`;
                itemClone.querySelector('.item-select-checkbox').checked = State.appState.selectedItemIds.has(id);
                itemClone.querySelector('.page-title').textContent = title;
                itemClone.querySelector('.no-index-badge').classList.toggle('d-none', !seo?.isNoIndex);
                itemClone.querySelector('.orphan-page-badge').classList.toggle('d-none', !seo?.isOrphan);
                itemClone.querySelector('.orphan-page-prompt').classList.toggle('d-none', !seo?.isOrphan);
                ['preview', 'edit', 'delete'].forEach(action => itemClone.querySelector(`.btn-${action}`).setAttribute('aria-label', `${action}: ${title}`));
                itemClone.querySelector('[data-populate="url"]').textContent = url;
                itemClone.querySelector('[data-populate="loadTime"]').textContent = seo?.loadTime ? `${seo.loadTime}ms` : '';
                itemClone.querySelector('[data-field="description"]').textContent = description;
                itemClone.querySelector('[data-field="category"]').textContent = category || '';
                itemClone.querySelector('[data-field="tags"]').textContent = (tags || []).join(', ');
                itemClone.querySelector('.seo-summary-container').innerHTML = renderSeoSummary(seo, id);
                fragment.appendChild(itemClone);
            });
            container.appendChild(fragment);
            const newRenderedCount = offset + itemsToRender.length;
            container.dataset.renderedCount = newRenderedCount;
            if (newRenderedCount < items.length) {
                const sentinel = Object.assign(document.createElement('div'), { className: 'scroll-sentinel' });
                container.appendChild(sentinel);
                scrollObserver.observe(sentinel);
            }
        }
        
        const handleLoadMore = (sentinel) => {
            const accordionBody = sentinel.closest('.accordion-body');
            if (!accordionBody) return;
            const source = accordionBody.dataset.source;
            const offset = parseInt(accordionBody.dataset.renderedCount, 10);
            const items = (getFilterState().keyword || getFilterState().category || getFilterState().isOrphan ? State.appState.filteredResults : State.appState.searchIndex).filter(item => (item.source || 'unknown') === source);
            sentinel.remove();
            renderItemChunk(accordionBody, items, offset);
        };

        const handleAccordionShow = (event) => {
            const accordionBody = event.target.querySelector('.accordion-body');
            if (accordionBody && parseInt(accordionBody.dataset.renderedCount, 10) === 0) {
                const source = accordionBody.dataset.source;
                const items = (getFilterState().keyword || getFilterState().category || getFilterState().isOrphan ? State.appState.filteredResults : State.appState.searchIndex).filter(item => (item.source || 'unknown') === source);
                if(items.length > 0) renderItemChunk(accordionBody, items, 0);
            }
        };

        function renderAccordionGroup(source, items, index, openAccordionId = null) {
            const sourceLabels = { 'seo_crawler': `<i class="bi bi-robot ms-2"></i>زاحف SEO`, 'html_analysis': `<i class="bi bi-file-earmark-code-fill ms-2"></i>تحليل HTML`, 'manual': `<i class="bi bi-pencil-fill ms-2"></i>إدخال يدوي`, 'url_generation': `<i class="bi bi-link-45deg ms-2"></i>من الروابط`, 'sitemap': `<i class="bi bi-map-fill ms-2"></i>من Sitemap`, 'robots': `<i class="bi bi-robot ms-2"></i>من robots.txt`};
            const collapseId = `collapse-source-${source.replace(/[^a-zA-Z0-9]/g, '-')}-${index}`;
            const shouldBeOpen = openAccordionId ? (collapseId === openAccordionId) : index === 0;
            const accordionItem = document.createElement('div');
            accordionItem.className = 'accordion-item bg-transparent';
            accordionItem.innerHTML = `<h2 class="accordion-header" id="heading-${collapseId}"><button class="accordion-button ${shouldBeOpen ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">${sourceLabels[source] || source} (${items.length})</button></h2><div id="${collapseId}" class="accordion-collapse collapse ${shouldBeOpen ? 'show' : ''}" data-bs-parent="#resultsAccordion"><div class="accordion-body" data-source="${source}" data-rendered-count="0"></div></div>`;
            DOM.dom.resultsAccordion.appendChild(accordionItem);
        }

        function displayResults(resultsToShow = null, openAccordionId = null) {
            const results = resultsToShow || State.appState.searchIndex;
            const hasResults = results.length > 0;
            DOM.dom.selectionControls.classList.toggle('d-none', !hasResults);
            DOM.dom.exportButtons.classList.toggle('d-none', !hasResults);
            DOM.dom.resultsPlaceholder.classList.toggle('d-none', hasResults);
            
            if(scrollObserver) DOM.dom.resultsAccordion.querySelectorAll('.scroll-sentinel').forEach(el => scrollObserver.unobserve(el));
            
            DOM.dom.resultsAccordion.innerHTML = '';
            if (!hasResults) return;
            const grouped = results.reduce((acc, item) => { (acc[item.source || 'unknown'] = acc[item.source || 'unknown'] || []).push(item); return acc; }, {});
            Object.entries(grouped).forEach(([source, items], index) => renderAccordionGroup(source, items, index, openAccordionId));
            updateSelectionUI();
        }

        const updateFilterOptions = () => {
            const currentCategory = DOM.dom.categoryFilter.value;
            const categories = [...new Set(State.appState.searchIndex.map(item => item.category).filter(Boolean))].sort();
            DOM.dom.categoryFilter.innerHTML = '<option value="">جميع الفئات</option>';
            categories.forEach(cat => DOM.dom.categoryFilter.add(new Option(cat, cat, false, cat === currentCategory)));
        };
        const updateSelectionUI = () => {
            document.querySelectorAll('.result-item').forEach(itemDiv => {
                const isSelected = State.appState.selectedItemIds.has(parseInt(itemDiv.dataset.id, 10));
                itemDiv.classList.toggle('selected', isSelected);
                const checkbox = itemDiv.querySelector('.item-select-checkbox');
                if (checkbox) checkbox.checked = isSelected;
            });
            DOM.dom.selectionCounter.textContent = State.appState.selectedItemIds.size;
        };
        const updateLiveCounter = () => {
            const count = State.appState.searchIndex.length;
            DOM.dom.liveCounter.classList.toggle('d-none', count === 0);
            if (count > 0) DOM.dom.counterValue.textContent = count;
        };
        const renderChart = (chartInstance, context, config) => {
            if (chartInstance) { chartInstance.data.labels = config.data.labels; chartInstance.data.datasets = config.data.datasets; chartInstance.update(); return chartInstance; }
            return new Chart(context, config);
        };
        
        // ✅ FIX: This function now only updates the charts when the modal is shown.
        function updateAnalyticsDashboard() {
            const hasData = State.appState.searchIndex && State.appState.searchIndex.length > 0;
            DOM.dom.showAnalyticsBtn.classList.toggle('d-none', !hasData);
            if (!hasData) {
                if (sourceChartInstance) sourceChartInstance.destroy(); if (keywordsChartInstance) keywordsChartInstance.destroy(); if (seoScoreChartInstance) seoScoreChartInstance.destroy();
                sourceChartInstance = keywordsChartInstance = seoScoreChartInstance = null; return;
            }
            
            const lightColor = '#495057';
            const darkColor = 'rgba(255, 255, 255, 0.85)';
            const themeColor = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? darkColor : lightColor;
            
            const sourceCounts = State.appState.searchIndex.reduce((acc, item) => { const source = item.source || 'unknown'; acc[source] = (acc[source] || 0) + 1; return acc; }, {});
            const sourceLabelsMap = { 'seo_crawler': `زاحف SEO`, 'html_analysis': `تحليل HTML`, 'manual': `إدخال يدوي`, 'url_generation': `من الروابط`, 'sitemap': `من Sitemap`, 'robots': `من robots.txt`, 'unknown': 'غير معروف' };
            sourceChartInstance = renderChart(sourceChartInstance, DOM.dom.sourceDistributionChart.getContext('2d'), { type: 'pie', data: { labels: Object.keys(sourceCounts).map(l => sourceLabelsMap[l] || l), datasets: [{ label: 'عدد الصفحات', data: Object.values(sourceCounts), backgroundColor: ['#4bc0c0', '#ff6384', '#ffcd56', '#36a2eb', '#9966ff', '#c9cbcf', '#ff9f40'] }] }, options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: themeColor, boxWidth: 12, padding: 15 } } } } });
            
            const allKeywords = State.appState.searchIndex.flatMap(item => item.tags || []);
            const keywordCount = allKeywords.reduce((acc, keyword) => { if (keyword) acc[keyword] = (acc[keyword] || 0) + 1; return acc; }, {});
            const sortedKeywords = Object.entries(keywordCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
            keywordsChartInstance = renderChart(keywordsChartInstance, DOM.dom.topKeywordsChart.getContext('2d'), { type: 'bar', data: { labels: sortedKeywords.map(e => e[0]), datasets: [{ label: 'عدد التكرارات', data: sortedKeywords.map(e => e[1]), backgroundColor: 'rgba(75, 192, 192, 0.6)' }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: themeColor } }, y: { ticks: { color: themeColor } } } } });
            
            let totalScore = 0, maxPossibleScore = 0;
            State.appState.searchIndex.forEach(item => { const { score, maxScore } = Analyzer.calculateSeoScore(item.seo); totalScore += score; maxPossibleScore += maxScore; });
            const avgPercentage = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;
            DOM.dom.seoScoreText.textContent = `${Math.round(avgPercentage)}%`;
            const scoreColor = avgPercentage >= 80 ? '#4bc0c0' : avgPercentage >= 50 ? '#ffcd56' : '#ff6384';
            seoScoreChartInstance = renderChart(seoScoreChartInstance, DOM.dom.averageSeoScoreChart.getContext('2d'), { type: 'doughnut', data: { datasets: [{ data: [avgPercentage, 100 - avgPercentage], backgroundColor: [scoreColor, 'rgba(128, 128, 128, 0.2)'], circumference: 180, rotation: 270, cutout: '75%' }] }, options: { responsive: true, maintainAspectRatio: true, plugins: { tooltip: { enabled: false } } } });
            
            const orphanCount = State.appState.searchIndex.filter(item => item.seo?.isOrphan).length;
            DOM.dom.orphanPagesCard.classList.toggle('d-none', orphanCount === 0);
            if(orphanCount > 0) DOM.dom.orphanPagesCount.textContent = orphanCount;
        }

        function updateAllUI(openAccordionId = null) {
            const filters = getFilterState();
            const results = (filters.keyword || filters.category || filters.isOrphan) ? State.appState.filteredResults : State.appState.searchIndex;
            displayResults(results, openAccordionId);
            if (openAccordionId && !document.getElementById(openAccordionId)) {
                const firstResult = results[0];
                if (firstResult) {
                    const source = firstResult.source || 'unknown';
                    const firstGroup = DOM.dom.resultsAccordion.querySelector(`[data-source="${source}"]`);
                    if(firstGroup) { const collapseElement = firstGroup.closest('.accordion-collapse'); if (collapseElement) new bootstrap.Collapse(collapseElement, {show: true}); }
                }
            } else if (openAccordionId) {
                const accordionBody = DOM.dom.resultsAccordion.querySelector(`#${openAccordionId} .accordion-body`);
                if (accordionBody && parseInt(accordionBody.dataset.renderedCount, 10) === 0) {
                    const source = accordionBody.dataset.source;
                    const items = results.filter(item => (item.source || 'unknown') === source);
                    if (items.length > 0) renderItemChunk(accordionBody, items, 0);
                }
            }
            updateAnalyticsDashboard(); // This now just toggles the button visibility
            updateLiveCounter();
            updateFilterOptions();
            const hasResults = State.appState.searchIndex.length > 0;
            DOM.dom.filterSection.classList.toggle('d-none', !hasResults);
            DOM.dom.selectionControls.classList.toggle('d-none', !hasResults || results.length === 0);
            DOM.dom.schemaGeneratorSection.classList.toggle('d-none', !hasResults);
        }

        const showSerpPreview = (itemId) => {
            const item = State.appState.searchIndex.find(i => i.id === itemId);
            if (!item) return;
            DOM.getEl('previewUrl').textContent = item.url; DOM.getEl('previewTitle').textContent = item.title;
            DOM.getEl('previewDescription').textContent = item.description; DOM.getEl('titleCharCount').textContent = item.title.length;
            DOM.getEl('descCharCount').textContent = item.description.length;
        };

        const validateSchemaEditor = () => {
            const editor = DOM.dom.schemaBaseEditor;
            try { JSON.parse(editor.value); editor.classList.remove('is-invalid'); editor.classList.add('is-valid'); return true; } 
            catch { editor.classList.remove('is-valid'); editor.classList.add('is-invalid'); return false; }
        };

        const enterEditMode = (item, pageItem, editBtn) => {
            pageItem.classList.add('is-editing');
            pageItem.querySelectorAll('.editable-content').forEach((el, index) => {
                const field = el.dataset.field;
                const input = field === 'description' ? document.createElement('textarea') : document.createElement('input');
                if(field === 'description') input.rows = 3; else input.type = 'text';
                Object.assign(input, { className: 'form-control form-control-sm edit-input', value: Array.isArray(item[field]) ? item[field].join(', ') : item[field] });
                Object.assign(input.dataset, { editField: field, originalTag: el.tagName.toLowerCase(), originalClasses: el.className });
                el.replaceWith(input);
                if (index === 0) input.focus();
            });
            editBtn.innerHTML = 'حفظ';
            editBtn.classList.replace('btn-outline-secondary', 'btn-success');
        };

        const saveEditMode = (item, pageItem, editBtn, onSave) => {
            const titleInput = pageItem.querySelector('[data-edit-field="title"]');
            if (!titleInput.value.trim()) return Utils.showNotification('حقل العنوان لا يمكن أن يكون فارغاً!', 'danger');
            pageItem.querySelectorAll('[data-edit-field]').forEach(input => {
                const field = input.dataset.editField; const value = input.value.trim();
                item[field] = field === 'tags' ? value.split(',').map(t => t.trim()).filter(Boolean) : value;
                const staticEl = document.createElement(input.dataset.originalTag);
                Object.assign(staticEl, { className: input.dataset.originalClasses, textContent: value });
                staticEl.dataset.field = field; input.replaceWith(staticEl);
            });
            pageItem.classList.remove('is-editing');
            editBtn.innerHTML = 'تحرير';
            editBtn.classList.replace('btn-success', 'btn-outline-secondary');
            Utils.showNotification('تم حفظ التعديلات!', 'success');
            updateAnalyticsDashboard();
            if(onSave) onSave();
        };

        const updateProjectListDropdown = (currentProjectName) => {
            const projects = JSON.parse(localStorage.getItem(State.CONSTANTS.PROJECTS_MASTER_KEY) || '[]');
            DOM.dom.projectSelector.innerHTML = '<option value="">-- اختر مشروعًا --</option>';
            projects.forEach(p => DOM.dom.projectSelector.add(new Option(p, p, false, p === currentProjectName)));
        };

        const initObserver = () => {
            if (scrollObserver) scrollObserver.disconnect();
            scrollObserver = new IntersectionObserver(handleIntersection, {
                root: DOM.dom.results, // Observe inside the scrollable container
                rootMargin: '0px 0px 200px 0px' // Load content 200px before it's visible
            });
        };

        return {
            getProjectName, getSelectedProjectName, getSeoCrawlerConfig, getUrlInput, getCustomProxyUrl,
            getManualPageData, getFilterState, getSchemaConfigFromDOM, isManualInputChecked,
            setFormValues, clearManualPageForm, clearFilterInputs,
            setDarkMode, toggleDarkMode, updateAllUI, handleAccordionShow, showSerpPreview, validateSchemaEditor,
            enterEditMode, saveEditMode, updateProjectListDropdown, initObserver
        };
    })(StateManager, DOMManager, Analyzer, Utils);


    /**
     * =================================================================
     * M O D U L E: DataHandler
     * -----------------------------------------------------------------
     * مسؤول عن معالجة البيانات، الإضافة، الحذف، والتوليد.
     * =================================================================
     */
    const DataHandler = (function (State, Analyzer, UI) {
        function addItemsToIndex(itemsToAdd) {
            const existingUrls = new Set(State.appState.searchIndex.map(item => (item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url)));
            let idCounter = State.appState.searchIndex.length > 0 ? Math.max(0, ...State.appState.searchIndex.map(item => item.id)) + 1 : 1;
            let addedCount = 0;
            itemsToAdd.forEach(item => {
                const urlKey = item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url;
                if (!existingUrls.has(urlKey)) { item.id = idCounter++; State.appState.searchIndex.push(item); existingUrls.add(urlKey); addedCount++; }
            });
            return addedCount;
        }

        function generateSearchIndexFromInputs(urlInputValue, isManualChecked) {
            const newItems = [];
            const existingUrls = new Set(State.appState.searchIndex.map(item => (item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url)));
            const addItem = (item) => {
                const urlKey = item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url;
                if (!existingUrls.has(urlKey)) newItems.push(item);
            };
            // ✅ FIX: Defensive coding ensures that if properties are missing from an old project, it doesn't crash.
            (State.appState.analyzedFiles || []).forEach(file => addItem({ ...file, category: file.category || (file.source === 'seo_crawler' ? 'زاحف SEO' : 'تحليل تلقائي'), tags: file.keywords?.length > 0 ? file.keywords : Analyzer.extractTagsFromUrl(file.url), source: file.source || 'html_analysis' }));
            if (isManualChecked) (State.appState.manualPages || []).forEach(page => addItem({ ...page, source: 'manual' }));
            urlInputValue.split('\n').filter(Boolean).forEach(urlStr => {
                const url = urlStr.trim().startsWith('/') ? urlStr.trim() : '/' + urlStr.trim();
                const urlKey = url.endsWith('/') && url.length > 1 ? url.slice(0, -1) : url;
                if (existingUrls.has(urlKey)) return;
                const fileName = url.split('/').pop().replace(/\.html?$/, '');
                const category = url.split('/').filter(Boolean)[0] || 'عام';
                const titleMap = { 'index': 'الصفحة الرئيسية', 'about': 'من نحن', 'contact': 'اتصل بنا', 'services': 'خدماتنا', 'blog': 'المدونة' };
                const title = titleMap[fileName.toLowerCase()] || (fileName.charAt(0).toUpperCase() + fileName.slice(1).replace(/[-_]/g, ' '));
                const source = (State.appState.sitemapUrls || []).includes(url) ? 'sitemap' : (State.appState.robotsUrls || []).includes(url) ? 'robots' : 'url_generation';
                addItem({ title, description: `صفحة ${title}`, url, category: category.charAt(0).toUpperCase() + category.slice(1), tags: Analyzer.extractTagsFromUrl(url), source });
            });
            return newItems;
        }

        function addManualPage(pageData) {
             if (!State.appState.manualPages) State.appState.manualPages = [];
            State.appState.manualPages.push({ ...pageData, url: pageData.url.startsWith('/') ? pageData.url : '/' + pageData.url, category: pageData.category || 'عام' });
        }
        
        function deleteItem(itemId, onComplete) {
            const item = State.appState.searchIndex.find(i => i.id === itemId);
            if (!item) return;
            if (confirm(`هل أنت متأكد من حذف العنصر:\n"${item.title}"`)) {
                State.appState.searchIndex = State.appState.searchIndex.filter(i => i.id !== itemId);
                State.appState.filteredResults = State.appState.filteredResults.filter(i => i.id !== itemId);
                State.appState.selectedItemIds.delete(itemId);
                if (onComplete) onComplete();
            }
        }
        
        function getSelectedItems() {
            const filters = UI.getFilterState();
            const baseList = (filters.keyword || filters.category || filters.isOrphan) ? State.appState.filteredResults : State.appState.searchIndex;
            return State.appState.selectedItemIds.size === 0 
                ? baseList
                : State.appState.searchIndex.filter(item => State.appState.selectedItemIds.has(item.id));
        }

        return { addItemsToIndex, generateSearchIndexFromInputs, addManualPage, deleteItem, getSelectedItems };
    })(StateManager, Analyzer, UIManager);


    /**
     * =================================================================
     * M O D U L E: ProjectManager
     * -----------------------------------------------------------------
     * مسؤول عن حفظ وتحميل وإدارة المشاريع في LocalStorage.
     * =================================================================
     */
    const ProjectManager = (function (State, UI, Utils) {
        let saveTimeout;

        const getProjectStorageKey = (name) => `${State.CONSTANTS.PROJECTS_MASTER_KEY}_${name}`;
        const getProjectList = () => { try { return JSON.parse(localStorage.getItem(State.CONSTANTS.PROJECTS_MASTER_KEY)) || []; } catch { return []; } };

        function saveProject(projectName, dataToSave) {
            if (!projectName) return;
            try {
                localStorage.setItem(getProjectStorageKey(projectName), JSON.stringify(dataToSave));
                const projects = getProjectList();
                if (!projects.includes(projectName)) { projects.push(projectName); localStorage.setItem(State.CONSTANTS.PROJECTS_MASTER_KEY, JSON.stringify(projects)); }
                localStorage.setItem(State.CONSTANTS.LAST_PROJECT_KEY, projectName);
                UI.updateProjectListDropdown(projectName);
            } catch (e) { Utils.showNotification('خطأ في حفظ البيانات: ' + e.message, 'danger'); }
        }

        const debouncedSaveProject = () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                const projectName = UI.getProjectName();
                const data = { ...State.appState, analyzedFiles: (State.appState.analyzedFiles || []).map(({ content, ...rest }) => rest), urlInput: UI.getUrlInput(), customProxyUrl: UI.getCustomProxyUrl(), timestamp: new Date().toISOString() };
                saveProject(projectName, data);
            }, 1000);
        };
        
        const clearCurrentState = () => {
            State.resetAppState();
            UI.setFormValues({ schemaConfig: { baseSchema: State.DEFAULT_BASE_SCHEMA_STR } });
            UI.clearFilterInputs();
            UI.validateSchemaEditor();
            UI.updateAllUI();
        };

        function loadProject(name) {
            if (!name) { clearCurrentState(); return; }
            try {
                const saved = localStorage.getItem(getProjectStorageKey(name));
                if (saved) {
                    State.resetAppState();
                    const data = JSON.parse(saved);
                    Object.assign(State.appState, data);
                    State.appState.selectedItemIds = new Set();
                    State.appState.schemaConfig = { ...StateManager.DEFAULT_BASE_SCHEMA_OBJ, ...(data.schemaConfig || {}) };
                    UI.setFormValues({ name, ...data });
                    UI.validateSchemaEditor();
                    localStorage.setItem(State.CONSTANTS.LAST_PROJECT_KEY, name);
                    UI.updateAllUI(); 
                    UI.updateProjectListDropdown(name);
                    Utils.showNotification(`تم تحميل مشروع "${name}"! <i class="bi bi-folder2-open ms-2"></i>`, 'info');
                }
            } catch (e) { Utils.showNotification('خطأ في تحميل المشروع: ' + e.message, 'warning'); }
        }

        function deleteProject(name) {
            localStorage.removeItem(getProjectStorageKey(name));
            localStorage.setItem(State.CONSTANTS.PROJECTS_MASTER_KEY, JSON.stringify(getProjectList().filter(p => p !== name)));
            UI.updateProjectListDropdown();
            Utils.showNotification(`تم حذف المشروع "${name}"!`, 'success');
        }

        return { debouncedSaveProject, clearCurrentState, loadProject, deleteProject, saveProject, getProjectList };
    })(StateManager, UIManager, Utils);


    /**
     * =================================================================
     * M O D U L E: CoreFeatures
     * -----------------------------------------------------------------
     * يحتوي على الميزات الأساسية للتطبيق مثل الزحف، التصدير، إلخ.
     * =================================================================
     */
    const CoreFeatures = (function (State, DOM, Analyzer, DataHandler, UI, Utils, ProjectManager) {
        
        // ✅ BUG FIX & PERFORMANCE: Rewrote the crawler to be truly concurrent and robust.
        async function startSeoCrawler(config) {
            let { baseUrl, maxDepth, crawlDelay, saveHtmlContent, concurrency } = config;
            try {
                if (!/^https?:\/\//i.test(baseUrl)) { baseUrl = 'https://' + baseUrl; }
                new URL(baseUrl);
            } catch (e) { return Utils.showNotification('رابط الموقع غير صالح', 'danger'); }

            const origin = new URL(baseUrl).origin;
            Utils.showNotification(`<i class="bi bi-rocket-takeoff-fill ms-2"></i> بدء زحف SEO لـ ${origin}...`, 'info');
            DOM.dom.crawlerStatus.classList.remove('d-none');

            let queue = [{ url: baseUrl, depth: 0 }];
            let visited = new Set([baseUrl]);
            let crawledData = new Map();
            let brokenLinks = new Set();
            let processedCount = 0;
            let activeWorkers = 0;

            const updateCrawlerUI = () => {
                const total = processedCount + queue.length + activeWorkers;
                DOM.dom.crawlerProgressBar.style.width = total > 0 ? `${(processedCount / total) * 100}%` : '0%';
                DOM.dom.crawlerProgressText.textContent = `${processedCount}/${total}`;
                DOM.dom.crawlerQueueCount.textContent = `في الانتظار: ${queue.length}`;
            };
            
            updateCrawlerUI();

            const worker = async () => {
                while (true) {
                    const task = queue.shift();
                    if (!task) {
                        if (activeWorkers === 0) break; // All tasks are done and all workers are idle
                        else {
                            await new Promise(r => setTimeout(r, 50)); // Wait for more tasks
                            continue;
                        }
                    }

                    activeWorkers++;
                    updateCrawlerUI();
                    
                    const { url, depth } = task;
                    DOM.dom.crawlerCurrentUrl.textContent = `فحص: ${new URL(url).pathname}...`;

                    try {
                        const startTime = performance.now();
                        const response = await fetch(Utils.getProxyUrl(url));
                        if (!response.ok) throw new Error(`Status ${response.status}`);
                        const html = await response.text();
                        const analysis = Analyzer.analyzeHtmlContent(html, url, { loadTime: Math.round(performance.now() - startTime) });

                        const linksOnPage = new Set();
                        new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href]').forEach(link => {
                            const href = link.getAttribute('href');
                            if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
                            try {
                                const absoluteUrl = new URL(href, url).href.split('#')[0];
                                linksOnPage.add(absoluteUrl);
                                if (absoluteUrl.startsWith(origin) && !visited.has(absoluteUrl) && depth < maxDepth && !/\.(jpg|jpeg|png|gif|svg|css|js|pdf|zip|webp|avif)$/i.test(absoluteUrl)) {
                                    visited.add(absoluteUrl);
                                    queue.push({ url: absoluteUrl, depth: depth + 1 });
                                }
                            } catch (e) {}
                        });

                        const dataForThisUrl = { analysis, outgoingLinks: [...linksOnPage] };
                        if (!saveHtmlContent) {
                            delete dataForThisUrl.analysis.content;
                        }
                        crawledData.set(url, dataForThisUrl);
                    } catch (error) {
                        console.error(`فشل في جلب ${url}:`, error);
                        brokenLinks.add(url);
                        Utils.showNotification(`<i class="bi bi-exclamation-triangle-fill ms-2"></i> فشل الاتصال بـ: ${new URL(url).pathname}`, 'warning');
                    } finally {
                        processedCount++;
                        activeWorkers--;
                        updateCrawlerUI();
                        await new Promise(r => setTimeout(r, crawlDelay));
                    }
                }
            };
            
            const workers = Array.from({ length: concurrency }, () => worker());
            await Promise.all(workers);
            
            DOM.dom.crawlerCurrentUrl.innerHTML = '<p class="text-center text-success fw-bold">اكتمل الزحف! جاري تحليل البيانات...</p>';
            DOM.dom.crawlerProgressBar.style.width = '100%';

            const allFoundUrls = new Set(crawledData.keys()), allLinkedToUrls = new Set(), linkEquityMap = new Map();
            crawledData.forEach(data => { data.outgoingLinks.forEach(link => { const cleanLink = link.split('#')[0].split('?')[0]; if (allFoundUrls.has(cleanLink)) { allLinkedToUrls.add(cleanLink); linkEquityMap.set(cleanLink, (linkEquityMap.get(cleanLink) || 0) + 1); } }); });
            crawledData.forEach((data, url) => { data.analysis.seo.isOrphan = !allLinkedToUrls.has(url) && url !== baseUrl; data.analysis.seo.brokenLinksOnPage = data.outgoingLinks.filter(link => brokenLinks.has(link)); data.analysis.seo.internalLinkEquity = linkEquityMap.get(url) || 0; });
            const orphanCount = [...crawledData.values()].filter(d => d.analysis.seo.isOrphan).length;
            if (orphanCount > 0) Utils.showNotification(`<i class="bi bi-exclamation-diamond-fill ms-2"></i> تم اكتشاف ${orphanCount} صفحة معزولة!`, 'warning', 7000);
            
            const newItems = Array.from(crawledData.values()).map(({ analysis }) => ({ ...analysis, category: 'زاحف SEO', tags: (analysis.keywords || []).length > 0 ? analysis.keywords : Analyzer.extractTagsFromUrl(analysis.url), source: 'seo_crawler' }));
            const addedCount = DataHandler.addItemsToIndex(newItems);
            
            Utils.showNotification( addedCount > 0 ? `<i class="bi bi-check-circle-fill ms-2"></i> اكتمل الزحف! تمت إضافة ${addedCount} صفحة جديدة.` : crawledData.size > 0 ? '🏁 اكتمل الزحف. جميع الصفحات التي تم العثور عليها موجودة بالفعل.' : '❌ فشل الزحف. لم يتم العثور على أي صفحات قابلة للوصول.', addedCount > 0 ? 'success' : (crawledData.size > 0 ? 'info' : 'danger'));
            if (brokenLinks.size > 0) Utils.showNotification(`<i class="bi bi-exclamation-octagon-fill ms-2"></i> تم العثور على ${brokenLinks.size} رابط داخلي مكسور.`, 'danger', 7000);
            setTimeout(() => { DOM.dom.crawlerStatus.classList.add('d-none'); DOM.dom.crawlerCurrentUrl.textContent = 'بدء العملية...'; }, 5000);
        }

        async function processTextualFile(file, urlExtractor, successMsg, noDataMsg, errorMsg) {
            try {
                const content = await Utils.readFileContent(file);
                const urls = urlExtractor(content);
                if (urls.length > 0) {
                    DOM.dom.urlInput.value += (DOM.dom.urlInput.value ? '\n' : '') + urls.join('\n');
                    Utils.showNotification(successMsg(urls.length), 'success');
                    ProjectManager.debouncedSaveProject();
                } else Utils.showNotification(noDataMsg, 'warning');
            } catch (e) { Utils.showNotification(errorMsg(e.message), 'danger'); }
        }
        
        async function processHtmlFiles(files) {
            let newFilesAnalyzed = 0;
            for (const file of files) {
                if (!(State.appState.analyzedFiles || []).some(f => f.filename === file.name)) {
                    try {
                        const analysis = Analyzer.analyzeHtmlContent(await Utils.readFileContent(file), file.name);
                        if (!State.appState.analyzedFiles) State.appState.analyzedFiles = [];
                        State.appState.analyzedFiles.push(analysis); newFilesAnalyzed++;
                    } catch (e) { console.error('Error processing file:', file.name, e); Utils.showNotification(`خطأ في معالجة ${file.name}`, 'danger'); }
                }
            }
            if (newFilesAnalyzed > 0) { Utils.showNotification(`تم تحليل ${newFilesAnalyzed} ملف HTML جديد!`, 'success'); ProjectManager.debouncedSaveProject(); }
            else Utils.showNotification('جميع الملفات تم تحليلها مسبقاً', 'info');
        }

        const getStrippedIndex = (items) => items.map(({ id, title, description, url, category, tags, seo }) => ({ id, title, description, url, category, tags, seo }));
        const downloadJson = () => { const items = DataHandler.getSelectedItems(); if (items.length === 0) return Utils.showNotification('لا توجد عناصر للتصدير', 'warning'); Utils.downloadFile(new Blob([JSON.stringify(getStrippedIndex(items), null, 2)], { type: 'application/json' }), 'search-index.json'); Utils.showNotification(`تم تحميل ${items.length} عنصر كـ JSON <i class="bi bi-filetype-json ms-2"></i>`, 'success'); };
        const downloadCSV = () => { const items = DataHandler.getSelectedItems(); if (items.length === 0) return Utils.showNotification('لا توجد عناصر للتصدير', 'warning'); const csv = ['ID,العنوان,الرابط,الوصف,الفئة,الكلمات المفتاحية', ...items.map(i => [`"${i.id}"`, `"${i.title.replace(/"/g, '""')}"`, `"${i.url}"`, `"${i.description.replace(/"/g, '""')}"`, `"${i.category || ''}"`, `"${(i.tags || []).join(', ')}"`].join(','))].join('\n'); Utils.downloadFile(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), 'search-index.csv'); Utils.showNotification(`تم تحميل ${items.length} عنصر كـ CSV <i class="bi bi-filetype-csv ms-2"></i>`, 'success'); };
        
        async function downloadZip() {
            const items = DataHandler.getSelectedItems();
            if (items.length === 0) return Utils.showNotification('لا توجد عناصر للتصدير', 'warning');
            DOM.dom.zipProgress.classList.remove('d-none');
            try {
                const zip = new JSZip();
                zip.file('search-index.json', JSON.stringify(getStrippedIndex(items), null, 2));
                const itemsWithContent = items.filter(item => item.content);
                
                if (itemsWithContent.length > 0) { 
                    const htmlFolder = zip.folder('html-files'); 
                    itemsWithContent.forEach(f => htmlFolder.file(f.filename, f.content));
                }
                const content = await zip.generateAsync({ type: 'blob' }, (metadata) => { DOM.dom.zipProgressBar.style.width = `${metadata.percent.toFixed(2)}%`; });
                Utils.downloadFile(content, 'search-index-package.zip');
                Utils.showNotification(`تم تحميل ${items.length} عنصر في حزمة ZIP <i class="bi bi-file-zip-fill ms-2"></i>`, 'success');
            } catch (error) { Utils.showNotification('خطأ في إنشاء ZIP: ' + error.message, 'danger'); } finally { setTimeout(() => DOM.dom.zipProgress.classList.add('d-none'), 2000); }
        }

        const copyToClipboard = (type) => {
            const items = DataHandler.getSelectedItems();
            if (items.length === 0) return Utils.showNotification('لا توجد عناصر للنسخ', 'warning');
            const dataMap = { all: () => JSON.stringify(getStrippedIndex(items), null, 2), titles: () => items.map(i => i.title).join('\n'), urls: () => items.map(i => i.url).join('\n'), descriptions: () => items.map(i => i.description).join('\n') };
            navigator.clipboard.writeText(dataMap[type]()).then(() => { Utils.showNotification(`تم نسخ بيانات ${items.length} عنصر إلى الحافظة! <i class="bi bi-clipboard-check-fill ms-2"></i>`, 'success'); DOM.dom.copyOptions.classList.add('d-none'); }).catch(err => Utils.showNotification('فشل النسخ!', 'danger'));
        };

        const sanitizeForFilename = (url) => (url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '_').replace(/[?&#=:%]/g, '-').replace(/\.html?$/, '') || 'index');
    
        async function generateAndDownloadSchema(schemaConfig) {
            const { baseUrl, pageSchemaType, baseSchema } = schemaConfig;
            const items = DataHandler.getSelectedItems();
            if (items.length === 0) {
                Utils.showNotification('<strong>خطوة ناقصة:</strong> يجب أولاً توليد قائمة بالصفحات.', 'warning', 7000);
                DOM.dom.results.classList.add('border', 'border-warning', 'border-3', 'shadow');
                setTimeout(() => DOM.dom.results.classList.remove('border', 'border-warning', 'border-3', 'shadow'), 2500); return;
            }
            const zip = new JSZip();
            try {
                const baseSchemaObject = JSON.parse(baseSchema);
                baseSchemaObject.url = baseUrl; baseSchemaObject['@id'] = new URL('#website', baseUrl).href;
                zip.file('_schema_base.jsonld', JSON.stringify(baseSchemaObject, null, 2));
                const publisherName = baseSchemaObject.name || "Your Organization Name";
                const publisherLogoUrl = baseSchemaObject.logo || new URL("/logo.png", baseUrl).href;
                for (const item of items) {
                    const pageUrl = new URL(item.url, baseUrl).href;
                    const pageSchema = { "@context": "https://schema.org", "@type": pageSchemaType, "@id": pageUrl, name: item.title, headline: item.title, description: item.description, url: pageUrl, isPartOf: { "@id": baseSchemaObject['@id'] }, primaryImageOfPage: { "@type": "ImageObject", url: (item.seo?.ogImage) ? new URL(item.seo.ogImage, baseUrl).href : new URL('/og-image.png', baseUrl).href }, datePublished: new Date().toISOString().split('T')[0], dateModified: new Date().toISOString().split('T')[0] };
                    if (['Article', 'Product', 'Service'].includes(pageSchemaType)) { pageSchema.author = { "@type": "Organization", name: publisherName }; pageSchema.publisher = { "@type": "Organization", name: publisherName, logo: { "@type": "ImageObject", url: publisherLogoUrl } }; }
                    zip.file(`${sanitizeForFilename(item.url)}.jsonld`, JSON.stringify(pageSchema, null, 2));
                }
                const content = await zip.generateAsync({ type: 'blob' });
                Utils.downloadFile(content, 'schema_package.zip');
                Utils.showNotification(`تم توليد حزمة سكيما لـ ${items.length} صفحة!`, 'success');
            } catch (e) { Utils.showNotification(`فشل في إنشاء حزمة السكيما: ${e.message}`, 'danger'); }
        }

        return { startSeoCrawler, processTextualFile, processHtmlFiles, downloadJson, downloadCSV, downloadZip, copyToClipboard, generateAndDownloadSchema };
    })(StateManager, DOMManager, Analyzer, DataHandler, UIManager, Utils, ProjectManager);


    /**
     * =================================================================
     * M A I N  A P P L I C A T I O N  (The Orchestrator)
     * -----------------------------------------------------------------
     * نقطة الدخول الرئيسية، مسؤول عن ربط الوحدات وإعداد معالجات الأحداث.
     * =================================================================
     */
    (function (State, DOM, UI, Data, Core, PM, Utils) {
        
        function handleGenerateClick() {
            const urlInput = UI.getUrlInput();
            const isManualChecked = UI.isManualInputChecked();
            const newItems = Data.generateSearchIndexFromInputs(urlInput, isManualChecked);

            if (newItems.length === 0 && State.appState.searchIndex.length === 0) return Utils.showNotification('يرجى إدخال بيانات أولاً', 'warning');
            
            const addedCount = Data.addItemsToIndex(newItems);
            Utils.showNotification(addedCount > 0 ? `تم إضافة ${addedCount} عنصر جديد! الإجمالي: ${State.appState.searchIndex.length}` : 'لا توجد عناصر جديدة للإضافة. النتائج محدّثة.', addedCount > 0 ? 'success' : 'info');
            
            UI.updateAllUI();
            PM.debouncedSaveProject();
        }

        function handleAddManualPage() {
            const pageData = UI.getManualPageData();
            if (!pageData.title || !pageData.url) return Utils.showNotification('يرجى إدخال العنوان والرابط على الأقل', 'warning');
            
            Data.addManualPage(pageData);
            UI.clearManualPageForm();
            Utils.showNotification(`تم إضافة: ${pageData.title} يدويًا. اضغط "توليد" لإظهارها.`, 'success');
            PM.debouncedSaveProject();
        }

        function handleManualSave() {
            const projectName = UI.getProjectName();
            if (!projectName) return Utils.showNotification('يرجى إدخال اسم للمشروع.', 'warning');
            
            if (UI.validateSchemaEditor()) {
                State.appState.schemaConfig = UI.getSchemaConfigFromDOM();
            } else {
                Utils.showNotification('تم حفظ المشروع، لكن "السكيما الأساسية" تحتوي على أخطاء.', 'warning', 6000);
            }
            const dataToSave = { ...State.appState, analyzedFiles: (State.appState.analyzedFiles || []).map(({ content, ...rest }) => rest), urlInput: UI.getUrlInput(), customProxyUrl: UI.getCustomProxyUrl(), timestamp: new Date().toISOString() };
            PM.saveProject(projectName, dataToSave);
            Utils.showNotification(`تم حفظ المشروع "${projectName}"! <i class="bi bi-save-fill ms-2"></i>`, 'success');
        }

        function handleDeleteProject() {
            const projectName = UI.getSelectedProjectName();
            if (!projectName) return Utils.showNotification('يرجى اختيار مشروع لحذفه.', 'warning');
            if (confirm(`هل أنت متأكد من حذف المشروع "${projectName}"؟`)) {
                PM.deleteProject(projectName);
                if (UI.getProjectName() === projectName) PM.clearCurrentState();
            }
        }
        
        async function handleStartCrawler() {
            const config = UI.getSeoCrawlerConfig();
            if (!config.baseUrl) return Utils.showNotification('يرجى إدخال رابط الموقع للزحف', 'warning');
            await Core.startSeoCrawler(config);
            UI.updateAllUI(); // Refresh UI after crawl
            PM.debouncedSaveProject();
        }

        async function handleGenerateSchema() {
            if (!UI.validateSchemaEditor()) {
                Utils.showNotification('يرجى تصحيح الأخطاء في "السكيما الأساسية" قبل المتابعة.', 'danger');
                DOM.dom.schemaBaseEditor.focus();
                return;
            }
            const schemaConfig = UI.getSchemaConfigFromDOM();
            if (!schemaConfig.baseUrl) return Utils.showNotification('يرجى إدخال رابط الموقع الأساسي.', 'warning');
            
            State.appState.schemaConfig = schemaConfig;
            await Core.generateAndDownloadSchema(schemaConfig);
        }
        
        function handleExportReport() {
            const items = State.appState.searchIndex;
            if (items.length === 0) {
                return Utils.showNotification('لا توجد بيانات لإنشاء تقرير. يرجى تحليل بعض الصفحات أولاً.', 'warning');
            }

            const totalPages = items.length;
            const orphanPages = items.filter(i => i.seo?.isOrphan);
            const noIndexPages = items.filter(i => i.seo?.isNoIndex);
            const missingH1 = items.filter(i => i.seo && !i.seo.h1);
            const missingDesc = items.filter(i => !i.description || i.description.startsWith('صفحة '));
            const pagesWithBrokenLinks = items.filter(i => i.seo?.brokenLinksOnPage?.length > 0);

            let totalScore = 0, maxPossibleScore = 0;
            items.forEach(item => { 
                const { score, maxScore } = Analyzer.calculateSeoScore(item.seo); 
                totalScore += score; 
                maxPossibleScore += maxScore; 
            });
            const avgSeoScore = maxPossibleScore > 0 ? ((totalScore / maxPossibleScore) * 100).toFixed(0) : 0;
            
            const renderList = (title, pages, badgeClass = 'danger') => {
                if (pages.length === 0) return '';
                return `
                    <h4 class="h6 mt-4">${title} <span class="badge bg-${badgeClass} ms-2">${pages.length}</span></h4>
                    <ul class="list-group list-group-flush">
                        ${pages.map(p => `<li class="list-group-item small d-flex justify-content-between align-items-center">
    <span>${p.title}</span>
    <span class="text-muted" dir="ltr">${p.url}</span>
</li>`).join('')}
                    </ul>`;
            };

            const reportHtml = `
                <div class="container-fluid">
                    <div class="row mb-4 p-3 rounded-3 bg-body-secondary">
                        <div class="col-md-3 text-center border-end">
                            <h3 class="h6 text-muted">إجمالي الصفحات</h3>
                            <p class="fs-2 fw-bold mb-0">${totalPages}</p>
                        </div>
                        <div class="col-md-3 text-center border-end">
                            <h3 class="h6 text-muted">متوسط تقييم SEO</h3>
                            <p class="fs-2 fw-bold mb-0">${avgSeoScore}%</p>
                        </div>
                        <div class="col-md-3 text-center border-end">
                            <h3 class="h6 text-muted">صفحات معزولة</h3>
                            <p class="fs-2 fw-bold mb-0 text-warning">${orphanPages.length}</p>
                        </div>
                        <div class="col-md-3 text-center">
                            <h3 class="h6 text-muted">صفحات NoIndex</h3>
                            <p class="fs-2 fw-bold mb-0 text-danger">${noIndexPages.length}</p>
                        </div>
                    </div>
                    
                    <h3 class="h5 mt-4 mb-3 border-bottom pb-2">ملخص المشاكل والتوصيات</h3>
                    
                    ${renderList('صفحات معزولة (Orphan Pages)', orphanPages, 'warning')}
                    ${renderList('صفحات مستبعدة من الفهرسة (NoIndex)', noIndexPages)}
                    ${renderList('صفحات بدون عنوان H1', missingH1)}
                    ${renderList('صفحات بدون وصف Meta', missingDesc, 'info')}
                    ${renderList('صفحات بها روابط داخلية مكسورة', pagesWithBrokenLinks)}

                    ${(orphanPages.length + noIndexPages.length + missingH1.length + missingDesc.length + pagesWithBrokenLinks.length === 0) ? '<p class="text-center text-success mt-4">✓ رائع! لم يتم العثور على مشاكل حرجة.</p>' : ''}
                </div>
            `;
            
            DOM.dom.reportModalBody.innerHTML = reportHtml;
            const reportModal = new bootstrap.Modal(DOM.dom.reportModal);
            reportModal.show();
        }

        function toggleEdit(itemId) {
            const pageItem = document.querySelector(`.result-item[data-id="${itemId}"]`);
            if (!pageItem) return;
            const editBtn = pageItem.querySelector('.btn-edit');
            const item = State.appState.searchIndex.find(i => i.id === itemId);
            if (!item) return;
            if (pageItem.classList.contains('is-editing')) UI.saveEditMode(item, pageItem, editBtn, PM.debouncedSaveProject);
            else { UI.enterEditMode(item, pageItem, editBtn); UI.showSerpPreview(itemId); }
        }

        function toggleItemSelection(checkbox, itemId) {
            State.appState.selectedItemIds[checkbox.checked ? 'add' : 'delete'](itemId);
            UI.updateSelectionUI();
        }

        function selectAllItems() {
            const filters = UI.getFilterState();
            const itemsToSelect = (filters.keyword || filters.category || filters.isOrphan) ? State.appState.filteredResults : State.appState.searchIndex;
            itemsToSelect.forEach(item => State.appState.selectedItemIds.add(item.id));
            UI.updateSelectionUI();
        }

        function deselectAllItems() {
            const filters = UI.getFilterState();
            const itemsToDeselect = new Set(((filters.keyword || filters.category || filters.isOrphan) ? State.appState.filteredResults : State.appState.searchIndex).map(i => i.id));
            State.appState.selectedItemIds = new Set([...State.appState.selectedItemIds].filter(id => !itemsToDeselect.has(id)));
            UI.updateSelectionUI();
        }

        function applyFilters() {
            const openAccordionId = DOM.dom.resultsAccordion.querySelector('.accordion-collapse.show')?.id;
            const filters = UI.getFilterState();
            State.appState.filteredResults = State.appState.searchIndex.filter(item => 
                (!filters.category || item.category === filters.category) &&
                (!filters.keyword || (item.title + item.description + (item.tags || []).join(' ')).toLowerCase().includes(filters.keyword)) &&
                (!filters.isOrphan || item.seo?.isOrphan)
            );
            UI.updateAllUI(openAccordionId);
        }

        function setupEventListeners() {
            const listeners = {
                'darkModeToggle': { 'click': UI.toggleDarkMode }, 'startCrawlerBtn': { 'click': handleStartCrawler },
                'importUrlsFileBtn': { 'click': () => { const file = DOM.dom.urlsFileInput.files[0]; if(file) Core.processTextualFile(file, c => c.split('\n').filter(Boolean), len => `تم استخراج ${len} رابط من الملف!`, 'لم يتم العثور على روابط.', e => `خطأ: ${e}`); else Utils.showNotification('يرجى اختيار ملف أولاً', 'warning'); } },
                'addManualPageBtn': { 'click': handleAddManualPage }, 'generateIndexBtn': { 'click': handleGenerateClick },
                'selectAllBtn': { 'click': selectAllItems }, 'deselectAllBtn': { 'click': deselectAllItems },
                'downloadJsonBtn': { 'click': Core.downloadJson }, 'downloadCsvBtn': { 'click': Core.downloadCSV },
                'downloadZipBtn': { 'click': Core.downloadZip }, 'toggleCopyBtn': { 'click': () => DOM.dom.copyOptions.classList.toggle('d-none') },
                'saveProjectBtn': { 'click': handleManualSave }, 'projectSelector': { 'change': (e) => PM.loadProject(e.target.value) },
                'deleteProjectBtn': { 'click': handleDeleteProject }, 'clearFormBtn': { 'click': () => { if (confirm('هل أنت متأكد من مسح جميع البيانات الحالية؟')) { PM.clearCurrentState(); Utils.showNotification('تم مسح كل شيء.', 'info'); } } },
                'manualInput': { 'change': (e) => DOM.dom.manualInputSection.classList.toggle('d-none', !e.target.checked) },
                'hideCrawlerStatusBtn': { 'click': () => DOM.dom.crawlerStatus.classList.add('d-none') },
                'generateSchemaBtn': { 'click': handleGenerateSchema }, 'schemaBaseUrl': { 'change': PM.debouncedSaveProject },
                'schemaPageType': { 'change': PM.debouncedSaveProject }, 'schemaBaseEditor': { 'input': UI.validateSchemaEditor, 'blur': () => { if (UI.validateSchemaEditor()) PM.debouncedSaveProject(); } },
                'viewOrphanPagesBtn': { 'click': () => { DOM.dom.orphanFilter.checked = true; applyFilters(); DOM.dom.results.scrollIntoView({ behavior: 'smooth' }); } },
                'exportReportBtn': { 'click': handleExportReport },
                'printReportBtn': { 'click': () => window.print() },
                'analyticsModal': { 'show.bs.modal': UI.updateAnalyticsDashboard }
            };
            for (const id in listeners) { 
                const el = DOM.getEl(id);
                if (el) {
                    for (const event in listeners[id]) {
                        el.addEventListener(event, listeners[id][event]);
                    }
                }
            }

            DOM.dom.categoryFilter.addEventListener('change', applyFilters); DOM.dom.keywordFilter.addEventListener('input', applyFilters); DOM.dom.orphanFilter.addEventListener('change', applyFilters);
            DOM.dom.results.addEventListener('click', (e) => {
                const target = e.target.closest('button, .item-select-checkbox'); if (!target) return;
                const resultItem = target.closest('.result-item'); if (!resultItem) return;
                const itemId = parseInt(resultItem.dataset.id, 10);
                const actions = { 
                    'btn-edit': () => toggleEdit(itemId), 
                    'btn-preview': () => UI.showSerpPreview(itemId), 
                    'btn-delete': () => Data.deleteItem(itemId, () => { UI.updateAllUI(); PM.debouncedSaveProject(); }), 
                    'item-select-checkbox': () => toggleItemSelection(target, itemId) 
                };
                for (const className in actions) { if (target.classList.contains(className)) return actions[className](); }
            });
            DOM.dom.resultsAccordion.addEventListener('show.bs.collapse', UI.handleAccordionShow);
            if (DOM.dom.copyOptions) DOM.dom.copyOptions.addEventListener('click', e => { const btn = e.target.closest('button[data-copy-type]'); if (btn) Core.copyToClipboard(btn.dataset.copyType); });
        
            const setupDragDrop = (dropZoneId, fileInputId, fileTypeRegex, processFunction) => {
                const dropZone = DOM.getEl(dropZoneId); const fileInput = DOM.getEl(fileInputId); if (!dropZone || !fileInput) return;
                dropZone.addEventListener('click', () => fileInput.click());
                ['dragover', 'dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.toggle('dragover', eventName === 'dragover' || eventName === 'drop'); if (eventName === 'drop') { const files = [...e.dataTransfer.files].filter(f => fileTypeRegex.test(f.name)); if (files.length > 0) processFunction(fileInput.multiple ? files : files[0]); } }));
                fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) processFunction(fileInput.multiple ? [...e.target.files] : e.target.files[0]); });
            };
            const textualFileHandler = (extractor, success, noData, error) => file => Core.processTextualFile(file, extractor, success, noData, error);
            setupDragDrop('robotsDropZone', 'robotsFileInput', /\.txt$/, textualFileHandler(c => c.split('\n').filter(l => /^(dis)?allow:/i.test(l.trim())).map(l => l.split(':')[1]?.trim()).filter(Boolean), len => `تم استخراج ${len} مسار من robots.txt!`, 'لم يتم العثور على مسارات.', e => `خطأ: ${e}`));
            setupDragDrop('manifestDropZone', 'manifestFileInput', /\.json$/, textualFileHandler(c => { try { const d = JSON.parse(c); return [...(d.icons?.map(i => i.src) || []), ...(d.screenshots?.map(s => s.src) || []), d.start_url, ...(d.shortcuts?.map(s => s.url) || [])].filter(Boolean); } catch(err) { throw new Error('JSON غير صالح'); } }, len => `تم استخراج ${len} مسار من manifest.json!`, 'لم يتم العثور على مسارات.', e => `خطأ: ${e.message}`));
            setupDragDrop('sitemapDropZone', 'sitemapFileInput', /\.xml$/, textualFileHandler(c => { const d = new DOMParser().parseFromString(c, 'text/xml'); if (d.querySelector('parsererror')) throw new Error('XML غير صالح'); return [...d.querySelectorAll('url > loc, sitemap > loc')].map(el => { try { return new URL(el.textContent.trim()).pathname; } catch { return el.textContent.trim(); } }).filter(Boolean); }, len => `تم استخراج ${len} رابط من Sitemap!`, 'لم يتم العثور على روابط.', e => `خطأ: ${e.message}`));
            setupDragDrop('fileDropZone', 'htmlFileInput', /\.html?$/, Core.processHtmlFiles);
        }

        function init() {
            DOM.init();
            UI.initObserver();
            const initialDarkMode = localStorage.getItem('darkMode') === 'true' || (localStorage.getItem('darkMode') === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
            UI.setDarkMode(initialDarkMode);
            const lastProject = localStorage.getItem(State.CONSTANTS.LAST_PROJECT_KEY);
            if (lastProject) {
                PM.loadProject(lastProject);
            } else {
                UI.updateProjectListDropdown();
                UI.validateSchemaEditor();
            }
            setupEventListeners();
        }

        window.addEventListener('DOMContentLoaded', init);

    })(StateManager, DOMManager, UIManager, DataHandler, CoreFeatures, ProjectManager, Utils);

})();
