"""Backend fixtures for tests/leads_flow.py: Ghaziabad + Loni businesses with
real-looking coordinates, owners and several phones (mocked /maps-search and
/enrich-websites)."""
import json
import re

# fixture businesses per city: (name, lat, lng, owner, designation, mobiles, landline)
FIX = {
    'Ghaziabad': [
        ('Shipra Mall', 28.6415, 77.3712, 'Rakesh Sharma', 'Managing Director', ['9810011111', '9810022222'], '01204567890'),
        ('Yashoda Hospital', 28.6470, 77.3650, 'Neha Jain', 'Administrator', ['9990033333'], '01204111222'),
        ('Wave Mall Offices', 28.6440, 77.3690, '', '', ['9871144444'], ''),
        ('RDC Business Park', 28.6760, 77.4450, 'Anil Gupta', 'Owner', ['9312255555', '9312266666', '9312277777'], ''),
    ],
    'Loni': [
        ('Loni Tech Park', 28.7520, 77.2890, 'Sunil Kapoor', 'Director', ['9555088888'], '01202222333'),
        ('Gold Cold Storage Loni', 28.7480, 77.2930, 'Priya Singh', 'Proprietor', ['9818199999', '9818100000'], ''),
        ('Loni Heights Society', 28.7445, 77.2968, '', '', ['9711312121'], ''),
    ],
}
calls = {'maps': [], 'enrich': 0}


def backend(route):
    url = route.request.url
    body = json.loads(route.request.post_data or '{}')
    if url.endswith('/api/v1/leads/maps-search'):
        calls['maps'].append(body.get('queries', []))
        items = []
        for q in body.get('queries', []):
            city = 'Loni' if 'loni' in q.lower() else 'Ghaziabad' if 'ghaziabad' in q.lower() else None
            for i, (name, lat, lng, *_rest, mobiles, land) in enumerate(FIX.get(city, [])):
                items.append({'title': name, 'address': f'Plot {i + 3}, Main Road, {city}, Uttar Pradesh', 'searchString': q,
                              'phone': '+91 ' + mobiles[0], 'phones': [{'number': '+91 ' + mobiles[0], 'kind': 'mobile'}],
                              'website': f"https://{re.sub(r'[^a-z]', '', name.lower())}.in", 'totalScore': '4.3',
                              'url': f'https://www.google.com/maps/place/x/data=!3d{lat}!4d{lng}', 'latitude': lat, 'longitude': lng, 'countryCode': 'IN'})
        return route.fulfill(status=200, body=json.dumps({'success': True, 'items': items}), headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
    if url.endswith('/api/v1/leads/enrich-websites'):
        calls['enrich'] += 1
        out = []
        by_host = {re.sub(r'[^a-z]', '', f[0].lower()): f for rows in FIX.values() for f in rows}
        for rec in body.get('records', []):
            host = re.sub(r'^https?://|\.in.*$', '', rec.get('website', ''))
            f = by_host.get(host)
            r = dict(rec)
            if f:
                name, *_x, owner, desig, mobiles, land = f
                r.update({'email': f'info@{host}.in', 'emails': [f'info@{host}.in', f'sales@{host}.in'],
                          'phones': [{'number': '+91 ' + m, 'kind': 'mobile'} for m in mobiles] + ([{'number': '+91 ' + land[1:], 'kind': 'landline'}] if land else []),
                          'crawler_enriched': True})
                if owner:
                    r.update({'contactPerson': owner, 'designation': desig, 'contactPersonSource': rec['website'] + '/about',
                              'authority': {'contactPerson': owner, 'designation': desig, 'source_url': rec['website'] + '/about', 'confidence': 0.75}})
            out.append(r)
        return route.fulfill(status=200, body=json.dumps({'success': True, 'records': out}), headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
    return route.fulfill(status=404, body='{}', headers={'Access-Control-Allow-Origin': '*'})
