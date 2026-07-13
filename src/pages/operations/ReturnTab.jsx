import MoveForm from './MoveForm'

export default function ReturnTab() {
  return (
    <MoveForm
      docType="sale_return"
      reasons={['Возврат от клиента', 'Не подошёл', 'Брак у клиента', 'Пересорт', 'Прочее']}
      tone="primary"
      verb="Вернуть"
      hint="Возврат продажи увеличивает остаток на складе. Выберите товар, количество и причину возврата."
    />
  )
}
