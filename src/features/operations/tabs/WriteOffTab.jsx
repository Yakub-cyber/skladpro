import MoveForm from './MoveForm'

export default function WriteOffTab() {
  return (
    <MoveForm
      docType="writeoff"
      reasons={['Брак', 'Недостача', 'Порча', 'Истёк срок', 'Прочее']}
      tone="danger"
      verb="Списать"
      hint="Списание уменьшает остаток. Укажите товар, количество и причину — создаётся документ списания."
    />
  )
}
