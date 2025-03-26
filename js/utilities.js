// DOM manipulation
function getEl(id) { return document.getElementById(id) }
function getElWithQuery(query) { return document.querySelector(query) }
function getElsWithQuery(query) { return document.querySelectorAll(query) }
function forElsMatching(query, callback) { [].forEach.call(document.querySelectorAll(query), callback) }
function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild) }
function makeEl(tag, attrs={}) {
    let el = document.createElement(tag)
    Object.keys(attrs).forEach(attr => el.setAttribute(attr, attrs[attr]))
    return el
}
function appendToEl(el, html) {
    el.append(htmlToEl(html))
}
function prependToEl(el, html) {
    el.prepend(htmlToEl(html))
}
function htmlToEl(html) {
    let docFrag = document.createDocumentFragment()
    let range = document.createRange()
    range.setStart(docFrag, 0)
    docFrag.appendChild(range.createContextualFragment(html))
    return docFrag
}

// data collection
function buildApiURL(content_type, params=[]) {
    let url = `${window.vari.corporaHost}/api/corpus/${window.vari.corpusID}/${content_type}/`
    let paramString = params.length ? `?${params.join('&')}` : ''
    return `${url}${paramString}`
}
function populateData(callback) {
    let api = buildApiURL('Edition', [
        `f_work.id=${window.vari.workID}`,
        's_published=asc',
        'page-size=1000'
    ])
    fetch(api).then(r => r.json()).then(editions => {
        if (hasProp(editions, 'records')) {
            editions.records.forEach(edition => {
                window.vari.ordered_editions.push(edition.id)
                window.vari.editions[edition.id] = edition
                window.vari.editions[edition.id].ordered_tlns = new Set()

                if (!edition.upstream_influence) window.vari.copytexts[edition.id] = []
            })

            editions.records.forEach(edition => {
                if (!(edition.id in window.vari.copytexts)) {
                    let rootID = determineRootInfluence(edition.id)
                    if (rootID !== null && (rootID in window.vari.copytexts)) window.vari.copytexts[rootID].push(edition.id)
                }
            })
        }

        let tlnURL = buildApiURL(window.vari.atomContentType, [
            'a_terms_tlns=tln',
            'page-size=0'
        ])
        fetch(tlnURL).then(r => r.json()).then(tlnAgg => {
            if (hasProp(tlnAgg, 'meta.aggregations.tlns')) {
                let tlns = tlnAgg.meta.aggregations.tlns
                tlns = Object.keys(tlns).map(tln => parseInt(tln))
                tlns.sort((a, b) => a - b).forEach(tln => window.vari.ordered_tlns.add(tln))

                let atomsURL = buildApiURL(window.vari.atomContentType, [
                    's_edition.published=asc',
                    's_ln=asc',
                    'only=uri,edition.id,tln,ln,content,text,new_stanza',
                    'page-size=5000'
                ])
                fetch(atomsURL).then(r => r.json()).then(atoms => {
                    if (hasProp(atoms, 'records')) {
                        atoms.records.forEach(atom => {
                            let atomKey = `${atom.edition.id}-${atom.tln}`
                            window.vari.atoms[atomKey] = atom
                            window.vari.editions[atom.edition.id].ordered_tlns.add(atom.tln)
                        })
                    }
                    callback()
                })
            }
        })
    })
}
function determineRootInfluence(editionID, edsTraversed=[]) {
    if (editionID in window.vari.copytexts) return editionID
    else if (editionID in window.vari.editions && !edsTraversed.includes(editionID)) {
        edsTraversed.push(editionID)
        if (window.vari.editions[editionID].upstream_influence)
            return determineRootInfluence(window.vari.editions[editionID].upstream_influence.id, edsTraversed)
    }
    return null
}
function hasProp(obj, path) {
    return path.split(".").every(function(x) {
        if(typeof obj != "object" || obj === null || ! x in obj)
            return false
        obj = obj[x]
        return true
    })
}
function parseDateString(timestamp, granularity='Day', adjustForTimezone=true) {
    let date = new Date(timestamp)
    if (granularity === 'Day')
        return date.toISOString().split('T')[0]
    else if (granularity === 'Year')
        return date.toLocaleString('default', { year: 'numeric' })
    else if (granularity === 'Month')
        return date.toLocaleString('default', { month: 'long', year: 'numeric' })
}

// variorum presentation
function makeDiff(a, b) {
    let fragment = document.createDocumentFragment()
    let diff = Diff.diffWords(stripHTML(a), stripHTML(b))
    let isVariant = false

    for (let i=0; i < diff.length; i++) {

        if (diff[i].added && diff[i + 1] && diff[i + 1].removed) {
            let swap = diff[i];
            diff[i] = diff[i + 1];
            diff[i + 1] = swap;
        }

        let node = null
        if (diff[i].removed) {
            node = document.createElement('del')
            node.appendChild(document.createTextNode(diff[i].value))
            isVariant = true
        } else if (diff[i].added) {
            node = document.createElement('ins')
            node.appendChild(document.createTextNode(diff[i].value))
            isVariant = true
        } else if (diff[i].chunkHeader) {
            node = document.createElement('span')
            node.setAttribute('class', 'chunk-header')
            node.appendChild(document.createTextNode(diff[i].value))
            isVariant = true
        } else {
            node = document.createTextNode(diff[i].value)
        }
        fragment.appendChild(node)
    }

    return [fragment, isVariant]
}
function stripHTML(htmlString) {
    // Create a temporary DOM element
    const tempElement = document.createElement('div');

    // Set the HTML content of the temporary element
    tempElement.innerHTML = htmlString;

    // Return only the text content, which excludes HTML tags
    return tempElement.textContent || tempElement.innerText || '';
}
function makeHistogram(slots) {
    let indicators = slots.map(isVariant => `<td class="diff-indicator${isVariant ? ' variant' : ''}">&nbsp;</td>`)
    return `
        <table border="0" cellspacing="0" cellpadding="0" class="histogram">
            <tr>
                ${indicators.join('\n')}
            </tr>
        </table>
    `
}
function makeEditionLink(ed) {
    let pubDate = parseDateString(ed.published, 'Year')
    return `<a href="${window.vari.corporaHost}${ed.uri}" target="_blank">${ed.siglum} ${pubDate}</a>`
}
function makeLineLink(line, diffElement=null, original_ln=null) {
    let lineLink = makeEl('a', {
        href: `${window.vari.corporaHost}${line.uri}`,
        target: '_blank'
    })

    if (diffElement !== null) lineLink.appendChild(diffElement)
    else lineLink.innerHTML = line.content

    let lineNum = makeEl('span', {
        class: `ln-holder${ original_ln !== null && original_ln !== line.ln ? ' variant' : '' }`
    })
    lineNum.innerHTML = line.ln
    lineLink.prepend(lineNum)

    return lineLink
}
