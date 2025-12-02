# パフォーマンス最適化

## DOM要素キャッシュ（O(1)）

```javascript
let inputCache = { production: {}, shipment: {}, stock: {} };
// [lineIndex][dateIndex][shift][itemName]
```

## デバウンス（150ms）

```javascript
const debouncedUpdate = debounce(heavyCalculation, 150);
input.addEventListener('input', debouncedUpdate);
```

## ループ最適化

```javascript
// 遅: forEach / 速: for
for (let i = 0; i < items.length; i++) { /* */ }
```

## イベント

```javascript
document.querySelectorAll('.production-input, .shipment-input')
    .forEach(input => input.addEventListener('input', debouncedUpdateStockQuantities));
```
