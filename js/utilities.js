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
    let diff = Diff.diffWords(distillHTML(a), distillHTML(b))
    let isVariant = false
    let styleNode = null

    for (let i=0; i < diff.length; i++) {

        if (diff[i].added && diff[i + 1] && diff[i + 1].removed) {
            let swap = diff[i]
            diff[i] = diff[i + 1]
            diff[i + 1] = swap
        }

        let tagsAndText = getTagsAndText(diff[i].value)
        let node = null

        if (tagsAndText.opened_tags.length && (diff[i].added || diff[i].removed)) {
            styleNode = document.createElement('span')
            styleNode.classList.add('style-change')
            if (diff[i].added){
                styleNode.classList.add('added')
                tagsAndText.opened_tags.forEach(tag => styleNode.classList.add(`style-change-${tag}`))
            }
            else if (diff[i].removed) styleNode.classList.add('removed')
        }

        if (tagsAndText.text.trim().length) {
            if (diff[i].removed) {
                node = document.createElement('del')
                node.appendChild(document.createTextNode(tagsAndText.text))
                isVariant = true
            } else if (diff[i].added) {
                node = document.createElement('ins')
                node.appendChild(document.createTextNode(tagsAndText.text))
                isVariant = true
            } else if (diff[i].chunkHeader) {
                node = document.createElement('span')
                node.setAttribute('class', 'chunk-header')
                node.appendChild(document.createTextNode(tagsAndText.text))
                isVariant = true
            } else {
                node = document.createElement('template')
                node.innerHTML = diff[i].value
                node = node.content
            }
        }

        if (node !== null) {
            if (styleNode !== null) styleNode.appendChild(node)
            else fragment.appendChild(node)
        }

        if (tagsAndText.closed_tags.length && (diff[i].added || diff[i].removed)) {
            fragment.appendChild(styleNode)
            styleNode = null
        }
    }

    return [fragment, isVariant]
}
function distillHTML(htmlString) {
    let stylisticTags = ['em']
    let tagTransforms = {
        'i': 'em'
    }

    Object.keys(tagTransforms).forEach(tag => {
        htmlString = htmlString.replaceAll(`<${tag}>`, `<${tagTransforms[tag]}>`)
        htmlString = htmlString.replaceAll(`</${tag}>`, `</${tagTransforms[tag]}>`)
    })

    let tagsAndText = getTagsAndText(htmlString)

    tagsAndText.opened_tags.forEach(tag => {
        if (stylisticTags.includes(tag)) htmlString = htmlString.replaceAll(`<${tag}>`, ` <${tag}> `)
        else htmlString = htmlString.replaceAll(`<${tag}>`, '')
    })
    tagsAndText.closed_tags.forEach(tag => {
        if (stylisticTags.includes(tag)) htmlString = htmlString.replaceAll(`</${tag}>`, ` </${tag}> `)
        else htmlString = htmlString.replaceAll(`</${tag}>`, '')
    })

    htmlString = htmlString.split(' ').filter(part => part.length).join(' ')

    return htmlString
}
function getTagsAndText(input) {
    // Return empty result for empty or non-string input
    if (!input || typeof input !== 'string') {
        return { opened_tags: [], closed_tags: [], text: '' }
    }

    // Find all opening HTML tags in the string
    const openTagRegex = /<\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g
    const openTagMatches = [...input.matchAll(openTagRegex)]
    const openedTags = openTagMatches.map(match => match[1])

    // Find all closing HTML tags in the string
    const closeTagRegex = /<\s*\/\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g
    const closeTagMatches = [...input.matchAll(closeTagRegex)]
    const closedTags = closeTagMatches.map(match => match[1])

    // Extract text content by removing HTML tags
    const text = input.replace(/<\/?[^>]+(>|$)/g, '')

    return {
        opened_tags: openedTags, // Remove duplicates
        closed_tags: closedTags, // Remove duplicates
        text: text
    }
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
