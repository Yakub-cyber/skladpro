import MoveForm from './MoveForm'

export default function SupplierReturnTab() {
  return (
    <MoveForm
      docType="supplier_return"
      reasons={['Брак от поставщика', 'Пересорт', 'Излишек поставки', 'Не востребован', 'Прочее']}
      tone="danger"
      verb="Вернуть поставщику"
      hint="Возврат поставщику уменьшает остаток на складе. Выберите товар, количество и причину — создаётся документ возврата."
    />
  )
}
